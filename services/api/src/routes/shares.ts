import { HttpError } from "../errors.js";
import { json } from "../http.js";
import { hmac } from "../referee-evidence.js";
import {
  isShareToken,
  mintShareToken,
  SHARE_OPEN_CREDIT_CAP,
} from "../shares.js";
import {
  bodyOf,
  clientIp,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";

// Legacy and invitation share endpoints:
//
//   POST /shares              — mint an invitation token for Home or a profile
//   GET  /shares/{token}      — keep already-issued links readable
//
// New run shares use the deterministic /share/{playerId}/{runId} surface in
// published-shares.ts. The legacy resolver remains a compatibility contract.

const MINT_LIMIT_PER_HOUR = 60;
const OPEN_LIMIT_PER_HOUR = 600;

// POST /shares — Home and badge shares carry Recruiter attribution, but never
// Herald credit. Herald remains specifically about reach from shared results.
export async function createInviteShare(context: RouteContext) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "share-mint",
    clientIpHash(event, config.webOriginToken),
    MINT_LIMIT_PER_HOUR,
    60 * 60,
  );

  const body = bodyOf(event);
  const destination = body.destination;
  if (destination !== "home" && destination !== "player")
    throw new HttpError(400, "A valid share destination is required.");

  const profile = await repository.getProfile(session.sub);
  if (!profile)
    throw new HttpError(404, "Player profile not found.", "not_found");

  let destinationPlayerId: string | undefined;
  if (destination === "player") {
    if (typeof body.playerId !== "string" || !body.playerId.trim())
      throw new HttpError(400, "A player is required for this share.");
    const destinationPlayer = await repository.getPublicPlayer(body.playerId);
    if (!destinationPlayer)
      throw new HttpError(404, "That player could not be found.", "not_found");
    destinationPlayerId = destinationPlayer.player.id;
  }

  const token = mintShareToken();
  await repository.putShare({
    pk: `SHARE#${token}`,
    sk: "SHARE",
    token,
    kind: "invite",
    owner: session.sub,
    destination,
    ...(destinationPlayerId ? { destinationPlayerId } : {}),
    mintedAt: new Date().toISOString(),
  });
  return json(201, { token });
}

// GET /shares/{token} — what a shared link opens.
export async function getShare(context: RouteContext, token: string) {
  const { event, config, repository } = context;
  if (!isShareToken(token))
    throw new HttpError(404, "That link is not valid.", "not_found");
  await repository.useRateLimit(
    "share-open",
    clientIpHash(event, config.webOriginToken),
    OPEN_LIMIT_PER_HOUR,
    60 * 60,
  );

  const share = await repository.getShare(token);
  if (!share) throw new HttpError(404, "That link is not valid.", "not_found");

  // Invitation links are deliberately not Herald links. They carry the token
  // into a new account journey, but an open alone earns no badge progress and
  // therefore needs no per-link Herald visitor marker.
  if (share.kind === "invite") {
    return json(200, {
      token: share.token,
      kind: "invite",
      destination: share.destination,
      ...(share.destinationPlayerId
        ? { playerId: share.destinationPlayerId }
        : {}),
    });
  }

  const lookup = await repository.getPublicPlayer(share.playerId);

  // Drop opens from the sharer's own device. A player refreshing their own link
  // is not reach, and a badge that pays for it is a badge that pays for nothing.
  const viewer = sessionFor(event, config.sessionSecret);
  const isOwner = viewer?.sub === share.owner;
  if (!isOwner) {
    // Peppered, one-way, and scoped to this token — the same rule the referee
    // evidence works under. Drop counts opens per token; it never learns who
    // opened. Best-effort: the link opens whether or not the count lands.
    const visitorHash = hmac(
      config.telemetryPepper,
      `share:${token}:${clientIp(event, config.webOriginToken)}:${
        event.headers["user-agent"] ?? "unknown"
      }`,
    );
    try {
      const credited = await repository.creditShareOpen(
        token,
        visitorHash,
        SHARE_OPEN_CREDIT_CAP,
      );
      if (credited) await repository.addHeraldOpens(share.owner, 1);
    } catch (error) {
      console.warn("Share open could not be credited", {
        token,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  return json(200, {
    token: share.token,
    mode: share.mode,
    score: share.score,
    seasonId: share.seasonId,
    completedAt: share.completedAt,
    ...(share.series ? { series: share.series } : {}),
    ...(lookup ? { player: lookup.player } : {}),
  });
}
