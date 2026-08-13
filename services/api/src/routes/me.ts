import { arenaForXp, type GameMode } from "@elixir-drop/contracts";
import {
  BADGE_COUNTERS_VERSION,
  badgeStates,
  migrateBadgeCounters,
  recomputeCounters,
} from "../badges.js";
import { deleteButtondownSubscriber } from "../buttondown.js";
import { favoriteCard } from "../cards.js";
import { badRequest, HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { costAccuracy, weakCardIds } from "../learning.js";
import { generateNameOptions, isSafeGeneratedName } from "../names.js";
import { signToken, verifyToken } from "../signing.js";
import type { CrProfileSnapshot, NameClaims } from "../types.js";
import { normalizePlayerTag } from "../validation.js";
import {
  bodyOf,
  clientIpHash,
  ownerRunReviewExplanation,
  ownerRunReviewStatus,
  profileResponse,
  refreshedCrProfile,
  type RouteContext,
  runRecordResponse,
  sessionFor,
} from "./context.js";

const NAME_OPTIONS_SECONDS = 15 * 60;

// GET /me — the signed-in player's profile, learning summary, and history.
export async function getMe({ event, config, repository }: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const profile = await repository.getProfile(session.sub);
  if (!profile)
    throw new HttpError(
      404,
      "Player profile was not found.",
      "profile_not_found",
    );
  const [recentRuns, crProfile, cardStats, rankedAccess] = await Promise.all([
    repository.listRecentRuns(session.sub),
    profile.playerTag ? repository.getCrProfile(profile.playerTag) : undefined,
    // Best-effort like every other side lookup here — but logged, so a
    // persistently failing stats read is visible instead of silently
    // flattening every player's learning summary.
    repository.getCardStats(session.sub).catch((error) => {
      console.warn("Learning stats lookup failed", {
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
      return {};
    }),
    repository.rankedAccess(profile.playerId),
  ]);
  const badges = await badgeSummary(
    { event, config, repository },
    session.sub,
    profile,
    cardStats,
  );
  const recentDecisions = await repository.refereeDecisions(
    recentRuns.map((run) => run.runId),
  );
  return json(200, {
    player: profileResponse(profile, crProfile, rankedAccess),
    // Retain server-owned learning history for possible future coaching.
    // It is derived from validated transcripts and does not affect deals.
    learning: {
      weakCardIds: weakCardIds(cardStats, 8),
      costAccuracy: costAccuracy(cardStats),
    },
    badges,
    // Drop runs whose mode is no longer a live game — retired modes (e.g. the
    // vaulted five) still sit in a player's history, and the client validates
    // each run's mode against the current GAME_MODES enum, so an unfiltered
    // retired-mode row would fail the whole /me response.
    recentRuns: recentRuns
      .filter((run) => isGameMode(run.mode))
      .map((run) => {
        const decision = recentDecisions.get(run.runId);
        return runRecordResponse(
          run,
          ownerRunReviewStatus(decision),
          ownerRunReviewExplanation(decision),
        );
      }),
  });
}

// GET /me/seasons — every current-mode run grouped by its authoritative season.
// This is intentionally separate from /me: the global app shell refreshes /me,
// while the full paginated history is only useful on the profile screen.
export async function getMySeasons({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const history = (await repository.listRunHistory(session.sub)).filter(
    (run): run is typeof run & { mode: GameMode } => isGameMode(run.mode),
  );
  const decisions = await repository.refereeDecisions(
    history.map((run) => run.runId),
  );
  const runs = history.map((run) => {
    const decision = decisions.get(run.runId);
    return runRecordResponse(
      run,
      ownerRunReviewStatus(decision),
      ownerRunReviewExplanation(decision),
    );
  });
  const grouped = new Map<string, typeof runs>();
  for (const run of runs) {
    const season = grouped.get(run.seasonId) ?? [];
    season.push(run);
    grouped.set(run.seasonId, season);
  }
  console.info("Player season history read", {
    requestId: event.requestContext.requestId,
    seasons: grouped.size,
    runs: runs.length,
  });
  return json(200, {
    seasons: [...grouped.entries()].map(([id, seasonRuns]) => ({
      id,
      games: seasonRuns.length,
      runs: seasonRuns,
    })),
  });
}

// The player's badge ladders, backfilling once from history if they have never
// been computed (or the counter shape has moved on).
//
// The backfill is deliberately silent: `backfilled` tells the client to show a
// single "here's what you've already earned" summary rather than queue forty
// celebrations. It also cannot be complete — run history carries no transcripts,
// so Reps, Clean Sweep, Podium and the transcript-derived hidden badges start
// from the player's next run. See recomputeCounters for the full split.
//
// Best-effort, like every other side lookup on this route: a badge failure
// returns an empty ladder set rather than 500-ing a profile load.
async function badgeSummary(
  { event, repository }: RouteContext,
  sub: string,
  profile: { totalGames: number; xp?: number },
  cardStats?: Record<string, { correct: number }>,
) {
  try {
    const stored = await repository.getBadges(sub);
    if (stored && stored.version === BADGE_COUNTERS_VERSION) {
      return { badges: badgeStates(stored) };
    }
    const [runs, backfillCardStats] = await Promise.all([
      repository.listAllRuns(sub),
      cardStats
        ? Promise.resolve(cardStats)
        : repository.getCardStats(sub).catch(() => ({})),
    ]);
    const at = new Date().toISOString();
    const currentRuns = runs.filter(
      (run): run is typeof run & { mode: GameMode } => isGameMode(run.mode),
    );
    const counters = stored
      ? migrateBadgeCounters(stored, currentRuns, at)
      : recomputeCounters(
          currentRuns,
          backfillCardStats,
          { totalGames: profile.totalGames, xp: profile.xp ?? 0 },
          arenaForXp,
          at,
        );
    const saved = await repository.saveBadges(
      sub,
      counters,
      at,
      stored
        ? { version: stored.version, updatedAt: stored.updatedAt }
        : undefined,
    );
    if (!saved) {
      const concurrent = await repository.getBadges(sub);
      if (concurrent?.version === BADGE_COUNTERS_VERSION)
        return { badges: badgeStates(concurrent) };
    }
    console.info("Badges backfilled from history", {
      requestId: event.requestContext.requestId,
      runs: runs.length,
    });
    return { badges: badgeStates(counters), backfilled: true };
  } catch (error) {
    console.warn("Badge lookup failed", {
      requestId: event.requestContext.requestId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { badges: [] };
  }
}

// GET /players/{playerId} — the public, pseudonymous view of a player.
export async function getPublicPlayer(
  { event, config, repository }: RouteContext,
  rawPlayerId: string,
) {
  let playerId: string;
  try {
    playerId = decodeURIComponent(rawPlayerId);
  } catch {
    throw new HttpError(400, "Player ID is invalid.", "invalid_player_id");
  }
  if (!playerId || playerId.length > 100)
    throw new HttpError(400, "Player ID is invalid.", "invalid_player_id");
  await repository.useRateLimit("reads", clientIpHash(event), 1200, 60 * 60);
  const lookup = await repository.getPublicPlayer(playerId);
  if (!lookup)
    throw new HttpError(
      404,
      "Player profile was not found.",
      "player_not_found",
    );
  const crProfile = lookup.player.playerTag
    ? await repository.getCrProfile(lookup.player.playerTag)
    : undefined;
  const clashRoyale = lookup.player.playerTag
    ? {
        tag: lookup.player.playerTag,
        status: crProfile?.status ?? ("pending" as const),
        ...(crProfile?.name ? { name: crProfile.name } : {}),
        ...(crProfile?.clan ? { clan: crProfile.clan } : {}),
      }
    : undefined;
  const recentRuns = await repository.listRecentRuns(lookup.sub, 10);
  const decisions = await repository.refereeDecisions(
    recentRuns.map((run) => run.runId),
  );
  const badges = await badgeSummary(
    { event, config, repository },
    lookup.sub,
    lookup.player,
  );
  return json(200, {
    player: {
      ...lookup.player,
      ...(clashRoyale ? { clashRoyale } : {}),
    },
    badges,
    recentRuns: recentRuns
      .filter(
        (run) =>
          isGameMode(run.mode) &&
          run.mode !== "practice" &&
          decisions.get(run.runId)?.visibility !== "hidden",
      )
      .map((run) => runRecordResponse(run)),
  });
}

// POST /me/name-options — signed, card-bound player-name choices.
export async function createNameOptions({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  const card = favoriteCard(body.favoriteCardId);
  if (!card)
    throw new HttpError(
      400,
      "Choose a valid favorite card.",
      "invalid_favorite_card",
    );
  await repository.useRateLimit("names", session.sub, 10, 60 * 60);
  const names = await generateNameOptions(config.nameModelId, card.name);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const claims: NameClaims = {
    type: "names",
    sub: session.sub,
    favoriteCardId: card.id,
    names,
    iat: nowSeconds,
    exp: nowSeconds + NAME_OPTIONS_SECONDS,
  };
  return json(200, {
    favoriteCardId: card.id,
    names,
    nameToken: signToken(claims, config.sessionSecret),
  });
}

// DELETE /me — erase the account and everything derived from it.
export async function deleteMe({ event, config, repository }: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  if (body.confirmation !== "DELETE")
    throw new HttpError(
      400,
      "Type DELETE to confirm account deletion.",
      "deletion_confirmation_required",
    );
  const profile = await repository.getProfile(session.sub);
  const deleted = await repository.deleteAccount(session.sub);
  if (profile) {
    await deleteButtondownSubscriber(
      {
        apiKey: config.buttondownApiKey,
        newsletterId: config.buttondownNewsletterId,
      },
      profile.email,
    );
  }
  console.info("Player account deleted", {
    requestId: event.requestContext.requestId,
    deletedGames: deleted.deletedGames,
  });
  return json(200, { ok: true });
}

// PATCH /me — save the card-bound identity and/or the unverified player tag.
export async function patchMe({ event, config, repository }: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  const updates: {
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    clearPlayerTag?: boolean;
  } = {};

  if (Object.hasOwn(body, "playerTag")) {
    let tag: string | undefined;
    try {
      // A mistyped tag is the most common profile input; it must answer
      // with the validation message, not a generic 500.
      tag = normalizePlayerTag(body.playerTag);
    } catch (error) {
      throw badRequest(error);
    }
    if (tag) updates.playerTag = tag;
    else updates.clearPlayerTag = true;
  }
  const changesIdentity =
    Object.hasOwn(body, "publicName") || Object.hasOwn(body, "favoriteCardId");
  if (changesIdentity) {
    const card = favoriteCard(body.favoriteCardId);
    if (
      !card ||
      !isSafeGeneratedName(body.publicName) ||
      typeof body.nameToken !== "string"
    ) {
      throw new HttpError(
        400,
        "Choose a favorite card and one of its generated player names.",
        "invalid_player_identity",
      );
    }
    let nameClaims: NameClaims;
    try {
      nameClaims = verifyToken(body.nameToken, "names", config.sessionSecret);
    } catch {
      throw new HttpError(
        400,
        "Those name choices have expired. Choose your card again.",
        "expired_name_options",
      );
    }
    if (
      nameClaims.sub !== session.sub ||
      nameClaims.favoriteCardId !== card.id ||
      !nameClaims.names.includes(body.publicName)
    ) {
      throw new HttpError(
        400,
        "Choose a favorite card and one of its generated player names.",
        "invalid_player_identity",
      );
    }
    updates.publicName = body.publicName;
    updates.favoriteCardId = card.id;
  }
  if (!Object.keys(updates).length)
    throw new HttpError(400, "No profile changes were provided.");
  const profile = await repository.updateProfile(session.sub, updates);
  const crProfile: CrProfileSnapshot | undefined = profile.playerTag
    ? updates.playerTag
      ? await refreshedCrProfile(
          repository,
          config.crRequestQueueUrl,
          profile.playerTag,
        )
      : await repository.getCrProfile(profile.playerTag)
    : undefined;
  const rankedAccess = await repository.rankedAccess(profile.playerId);
  return json(200, {
    player: profileResponse(profile, crProfile, rankedAccess),
  });
}
