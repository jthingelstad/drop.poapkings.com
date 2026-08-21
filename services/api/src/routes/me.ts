import { arenaForXp, type GameMode } from "@elixir-drop/contracts";
import {
  BADGE_COUNTERS_VERSION,
  badgeStates,
  reconcileBadgeCounters,
} from "../badges.js";
import {
  buttondownPlayerMetadata,
  deleteButtondownSubscriber,
  updateButtondownSubscriberMetadata,
} from "../buttondown.js";
import { favoriteCard } from "../cards.js";
import { badRequest, HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { crSeasonIdFor } from "../seasons.js";
import {
  cardResultsFromTranscript,
  costAccuracy,
  weakCardIds,
} from "../learning.js";
import { generateNameOptions, isSafeGeneratedName } from "../names.js";
import { signToken, verifyToken } from "../signing.js";
import { publishTinylyticsEvent } from "../tinylytics.js";
import type {
  CrProfileSnapshot,
  NameClaims,
  RefereeDecision,
} from "../types.js";
import type { Repository } from "../repository.js";
import { normalizePlayerTag } from "../validation.js";
import { settleBadgeXp } from "../xp-awards.js";
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
    profile.playerId,
    profile,
    cardStats,
  );
  const xpProfile = (await repository.getProfile(session.sub)) ?? profile;
  const recentDecisions = await repository.refereeDecisions(
    recentRuns.map((run) => run.runId),
  );
  return json(200, {
    player: profileResponse(xpProfile, crProfile, rankedAccess),
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

const SEASON_ID_PATTERN = /^\d{4}-\d{2}(?:-\d+)?$/;
// `unreviewed` is not a stored decision — it is the absence of one, and the
// filter needs a name for it because it is what most runs are.
const REVIEW_STATUSES = [
  "pending",
  "reviewed",
  "excluded",
  "unreviewed",
] as const;

function isReviewStatus(
  value: string | undefined,
): value is (typeof REVIEW_STATUSES)[number] {
  return REVIEW_STATUSES.includes(value as (typeof REVIEW_STATUSES)[number]);
}

// GET /me/seasons — the player's run history, grouped by authoritative season.
// This is intentionally separate from /me: the global app shell refreshes /me,
// while the fuller history is only useful on the profile screen.
//
// The response is deliberately bounded. `index` lists every season the player
// has runs in with its game count — a handful of rows, enough to build a season
// picker and a "load the season before this one" control — while `seasons`
// carries the runs for ONE season by default. Players are already into the
// hundreds of games, and shipping a whole career to render one month is a
// payload that only grows.
//
//   (no season)   the most recent season the player played
//   season=<id>   that season
//   season=all    every season — explicit opt-in, never the default
//
// `mode` and `status` narrow further. A run no referee has touched has no
// status at all, so it answers `status=reviewed` only in the sense that it is
// eligible; it is matched by the dedicated `unreviewed` value instead.
export async function getMySeasons({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const seasonFilter = event.queryStringParameters?.season;
  if (
    seasonFilter !== undefined &&
    seasonFilter !== "all" &&
    !SEASON_ID_PATTERN.test(seasonFilter)
  )
    throw new HttpError(400, "Season ID is invalid.");
  const modeFilter = event.queryStringParameters?.mode;
  if (modeFilter !== undefined && !isGameMode(modeFilter))
    throw new HttpError(400, "Choose a valid game mode.");
  const statusFilter = event.queryStringParameters?.status;
  if (statusFilter !== undefined && !isReviewStatus(statusFilter))
    throw new HttpError(400, "Choose a valid review status.");

  const history = (await repository.listRunHistory(session.sub)).filter(
    (run): run is typeof run & { mode: GameMode } => isGameMode(run.mode),
  );

  // Built from the whole history because it has to be complete, but it costs
  // one row per season on the wire. `crSeasonId` is what the player actually
  // recognizes — "Season 135", not "2026-08" — so it travels with the index
  // rather than leaving the browser to guess at an internal id.
  const clock = await repository.getCrWarClock();
  const index = [...new Set(history.map((run) => run.seasonId))]
    .sort((left, right) => right.localeCompare(left))
    .map((id) => {
      const crSeasonId = crSeasonIdFor(id, clock);
      return {
        id,
        games: history.filter((run) => run.seasonId === id).length,
        ...(crSeasonId === undefined ? {} : { crSeasonId }),
      };
    });

  const requestedSeason =
    seasonFilter === undefined ? index[0]?.id : seasonFilter;
  const scoped = history.filter(
    (run) =>
      (requestedSeason === undefined ||
        requestedSeason === "all" ||
        run.seasonId === requestedSeason) &&
      (modeFilter === undefined || run.mode === modeFilter),
  );
  const decisions = await repository.refereeDecisions(
    scoped.map((run) => run.runId),
  );
  const runs = scoped
    .filter(
      (run) =>
        statusFilter === undefined ||
        (ownerRunReviewStatus(decisions.get(run.runId)) ?? "unreviewed") ===
          statusFilter,
    )
    .map((run) => {
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
  // Board placements are opt-in and scoped to one season, because each one is
  // a real leaderboard read. Only the run that actually holds the player's
  // position on a board gets a number — that is what the placement describes.
  const placements =
    event.queryStringParameters?.placements === "1" &&
    requestedSeason !== undefined &&
    requestedSeason !== "all"
      ? await seasonPlacements(repository, session.sub, requestedSeason, runs)
      : new Map<string, number>();

  console.info("Player season history read", {
    requestId: event.requestContext.requestId,
    indexedSeasons: index.length,
    seasons: grouped.size,
    runs: runs.length,
    placements: placements.size,
  });
  return json(200, {
    index,
    seasons: [...grouped.entries()].map(([id, seasonRuns]) => ({
      id,
      games: seasonRuns.length,
      runs: seasonRuns.map((run) => {
        const placement = placements.get(run.runId);
        return placement === undefined ? run : { ...run, placement };
      }),
    })),
  });
}

// One board read per ranked mode the player actually played that season, and
// none at all for a player who played none. The board row's achievedAt is the
// run's completedAt, which is what ties a placement to a specific run.
async function seasonPlacements(
  repository: Repository,
  sub: string,
  seasonId: string,
  runs: Array<{ runId: string; mode: GameMode; completedAt: string }>,
): Promise<Map<string, number>> {
  const placements = new Map<string, number>();
  const profile = await repository.getProfile(sub);
  if (!profile) return placements;
  const modes = [...new Set(runs.map((run) => run.mode))].filter(
    (mode) => mode !== "practice",
  );
  await Promise.all(
    modes.map(async (mode) => {
      let board: Array<Record<string, unknown>>;
      try {
        board = await repository.leaderboard(mode, seasonId);
      } catch {
        // A placement is decoration on a history row. A board that is briefly
        // unavailable must not fail the whole history read.
        return;
      }
      const row = board.find(
        (entry) =>
          (entry.player as { id?: string } | undefined)?.id ===
          profile.playerId,
      );
      if (!row || typeof row.rank !== "number") return;
      const run = runs.find(
        (candidate) =>
          candidate.mode === mode && candidate.completedAt === row.achievedAt,
      );
      if (run) placements.set(run.runId, row.rank);
    }),
  );
  return placements;
}

// The player's badge ladders, rebuilding from history when they have never been
// computed, the counter shape moved on, or a ranked-run referee decision
// invalidated the derived bag.
//
// The backfill is deliberately silent: `backfilled` tells the client to show a
// single "here's what you've already earned" summary rather than queue forty
// celebrations. It also cannot be complete — run history carries no transcripts,
// so Reps, Clean Sweep, Podium and the transcript-derived hidden badges start
// from the player's next run. See recomputeCounters for the full split.
//
// Best-effort, like every other side lookup on this route: a badge failure
// returns an empty ladder set rather than 500-ing a profile load. A missing
// excluded-run evidence item fails closed because subtracting only part of the
// retained card contribution would publish badges we cannot justify.
async function settleBadgeXpOnRead(
  repository: Repository,
  sub: string,
  counters: Parameters<typeof settleBadgeXp>[2],
  at: string,
  expected: { version: number; updatedAt?: string },
) {
  try {
    return await settleBadgeXp(repository, sub, counters, at, expected);
  } catch (error) {
    console.warn("Badge XP lookup failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { counters, awarded: 0, newlyEarned: [] };
  }
}

async function badgeSummary(
  { event, repository }: RouteContext,
  sub: string,
  playerId: string,
  profile: { totalGames: number; xp?: number },
  cardStats?: Record<string, { correct: number }>,
) {
  try {
    const [stored, badgeDecisionRevision] = await Promise.all([
      repository.getBadges(sub),
      repository.badgeDecisionRevision(playerId),
    ]);
    if (
      stored &&
      stored.version === BADGE_COUNTERS_VERSION &&
      stored.refereeReconciled === true &&
      stored.refereeDecisionRevision === badgeDecisionRevision
    ) {
      const settled = await settleBadgeXpOnRead(
        repository,
        sub,
        stored,
        new Date().toISOString(),
        { version: stored.version, updatedAt: stored.updatedAt },
      );
      return {
        badges: badgeStates(settled.counters),
        ...(settled.awarded > 0 ? { backfilled: true } : {}),
      };
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
    const decisions = await repository.refereeDecisions(
      currentRuns.flatMap((run) => (run.runId ? [run.runId] : [])),
    );
    const excluded = currentRuns.filter(
      (run) => run.runId && isFinalBadgeExclusion(decisions.get(run.runId)),
    );
    const excludedRunIds = excluded.flatMap((run) =>
      run.runId ? [run.runId] : [],
    );
    const evidence = await repository.refereeEvidenceForRuns(
      sub,
      excludedRunIds,
    );
    if (evidence.length !== excludedRunIds.length)
      throw new Error("Excluded run evidence is unavailable for badge repair");
    const evidenceByRun = new Map(
      evidence.map((item) => [item.runId, item] as const),
    );
    const counters = reconcileBadgeCounters(
      stored,
      currentRuns,
      backfillCardStats,
      { totalGames: profile.totalGames, xp: profile.xp ?? 0 },
      excluded.flatMap((run) => {
        if (!run.runId) return [];
        const item = evidenceByRun.get(run.runId);
        return [
          {
            runId: run.runId,
            completedAt: run.completedAt,
            // Canonical profile XP is never clawed back. This value only
            // keeps Arena Climber's referee-derived badge projection aligned
            // with the exact XP originally attached to the excluded run.
            xp: run.xp ?? 0,
            correctCards: item
              ? cardResultsFromTranscript(item.challenge, item.transcript)
                  .filter((result) => result.correct)
                  .map((result) => result.cardId)
              : [],
          },
        ];
      }),
      arenaForXp,
      at,
      badgeDecisionRevision,
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
      if (concurrent?.version === BADGE_COUNTERS_VERSION) {
        const settled = await settleBadgeXpOnRead(
          repository,
          sub,
          concurrent,
          at,
          { version: concurrent.version, updatedAt: concurrent.updatedAt },
        );
        return {
          badges: badgeStates(settled.counters),
          ...(settled.awarded > 0 ? { backfilled: true } : {}),
        };
      }
    }
    console.info("Badges reconciled from eligible history", {
      requestId: event.requestContext.requestId,
      runs: runs.length,
      excludedRuns: excluded.length,
    });
    const settled = await settleBadgeXpOnRead(repository, sub, counters, at, {
      version: counters.version,
      updatedAt: at,
    });
    return { badges: badgeStates(settled.counters), backfilled: true };
  } catch (error) {
    console.warn("Badge lookup failed", {
      requestId: event.requestContext.requestId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { badges: [] };
  }
}

function isFinalBadgeExclusion(decision: RefereeDecision | undefined): boolean {
  return (
    decision?.decidedBy === "fair-play-referee" &&
    decision.visibility === "hidden" &&
    decision.queueState !== "pending"
  );
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
    playerId,
    lookup.player,
  );
  const xpLookup = (await repository.getPublicPlayer(playerId)) ?? lookup;
  return json(200, {
    player: {
      ...xpLookup.player,
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
  const names = await generateNameOptions(config.nameModelId, card);
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
    lastOpenedUpdates?: string;
  } = {};

  // Opening the Updates view stamps the read time. The server owns the clock so
  // an unread indicator cannot be spoofed forward by a wrong device time.
  if (Object.hasOwn(body, "lastOpenedUpdates")) {
    updates.lastOpenedUpdates = new Date().toISOString();
  }

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
  const previousProfile = changesIdentity
    ? await repository.getProfile(session.sub)
    : undefined;
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
  const completedProfile =
    changesIdentity &&
    (!previousProfile?.favoriteCardId || !previousProfile.publicName) &&
    Boolean(profile.favoriteCardId && profile.publicName);
  await Promise.all([
    updateButtondownSubscriberMetadata(
      {
        apiKey: config.buttondownApiKey,
        newsletterId: config.buttondownNewsletterId,
      },
      profile.email,
      buttondownPlayerMetadata(
        profile,
        crProfile,
        updates.playerTag !== undefined || updates.clearPlayerTag === true,
      ),
    ),
    completedProfile
      ? publishTinylyticsEvent({ apiToken: config.tinylyticsApiToken }, event, {
          event: "account.profile_completed",
          path: "/profile",
        })
      : Promise.resolve(),
  ]);
  const rankedAccess = await repository.rankedAccess(profile.playerId);
  return json(200, {
    player: profileResponse(profile, crProfile, rankedAccess),
  });
}
