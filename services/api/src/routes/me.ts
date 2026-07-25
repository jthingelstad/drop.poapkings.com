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
  const [recentRuns, crProfile, cardStats] = await Promise.all([
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
  ]);
  return json(200, {
    player: profileResponse(profile, crProfile),
    // Retain server-owned learning history for possible future coaching.
    // It is derived from validated transcripts and does not affect deals.
    learning: {
      weakCardIds: weakCardIds(cardStats, 8),
      costAccuracy: costAccuracy(cardStats),
    },
    // Drop runs whose mode is no longer a live game — retired modes (e.g. the
    // vaulted five) still sit in a player's history, and the client validates
    // each run's mode against the current GAME_MODES enum, so an unfiltered
    // retired-mode row would fail the whole /me response.
    recentRuns: recentRuns
      .filter((run) => isGameMode(run.mode))
      .map(runRecordResponse),
  });
}

// GET /players/{playerId} — the public, pseudonymous view of a player.
export async function getPublicPlayer(
  { event, repository }: RouteContext,
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
  const recentRuns = await repository.listRecentRuns(lookup.sub, 10);
  return json(200, {
    player: lookup.player,
    recentRuns: recentRuns
      .filter((run) => isGameMode(run.mode) && run.mode !== "practice")
      .map(runRecordResponse),
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
  return json(200, { player: profileResponse(profile, crProfile) });
}
