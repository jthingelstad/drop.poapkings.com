import { HttpError } from "../errors.js";
import { json } from "../http.js";
import { hmac } from "../referee-evidence.js";
import {
  isShareToken,
  mintShareToken,
  normalizeShareSeries,
  SHARE_OPEN_CREDIT_CAP,
} from "../shares.js";
import {
  bodyOf,
  clientIp,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";

// The share function. Two endpoints:
//
//   POST /runs/{runId}/share  — mint a token for a run the caller owns
//   GET  /shares/{token}      — resolve it, and count the open
//
// A NOT-RECORDED run has nothing to mint: offline and guest runs have no server
// record, so no permalink can exist. The browser hides the control entirely
// rather than disabling it, and this endpoint is the second lock on the same
// rule — a disabled button invites a tap and then has to explain itself, and an
// endpoint that trusts the button has no rule at all.
//
// Nothing shareable that is not already public: score, mode, name, arena, badge
// count. The same set the public profile shows.

const MINT_LIMIT_PER_HOUR = 60;
const OPEN_LIMIT_PER_HOUR = 600;

// POST /runs/{runId}/share
export async function createShare(context: RouteContext, runId: string) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "share-mint",
    clientIpHash(event, config.webOriginToken),
    MINT_LIMIT_PER_HOUR,
    60 * 60,
  );

  const run = await repository.getRun(runId);
  if (!run || run.owner !== session.sub)
    throw new HttpError(404, "That run could not be found.", "not_found");
  // Guest and practice runs are not recorded, so there is nothing to point a
  // permalink at. Same for a run that has not finished scoring.
  if (run.guest || run.mode === "practice")
    throw new HttpError(
      409,
      "That run was not recorded, so it has no link.",
      "run_not_recorded",
    );
  if (
    run.state !== "completed" ||
    typeof run.score !== "number" ||
    !run.seasonId ||
    !run.completedAt
  )
    throw new HttpError(
      409,
      "That run has not finished yet.",
      "run_not_recorded",
    );

  const profile = await repository.getProfile(session.sub);
  if (!profile)
    throw new HttpError(404, "Player profile not found.", "not_found");

  const series = normalizeShareSeries(bodyOf(event).series);
  // One token per share ACTION. Sharing the same run twice mints two tokens,
  // which is what makes Herald countable per share rather than per run.
  const token = mintShareToken();
  await repository.putShare({
    pk: `SHARE#${token}`,
    sk: "SHARE",
    token,
    runId,
    owner: session.sub,
    playerId: profile.playerId,
    mode: run.mode,
    score: run.score,
    seasonId: run.seasonId,
    completedAt: run.completedAt,
    mintedAt: new Date().toISOString(),
    ...(series ? { series } : {}),
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
