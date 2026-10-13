import { createHash } from "node:crypto";
import type { HttpRequest } from "../http.js";
import { accountTagsFor } from "../account-tags.js";
import type { Config } from "../config.js";
import { enqueueRefresh } from "../refresh-jobs.js";
import { publicCrProfile } from "../cr-refresh.js";
import { badRequest, HttpError } from "../errors.js";
import { bearerToken } from "../http.js";
import { levelForGames } from "../progression.js";
import { refereeReviewStatus } from "../referee-status.js";
import type { Repository } from "../repository.js";
import { signToken, verifyToken } from "../signing.js";
import type {
  CrProfileSnapshot,
  ElixirLink,
  RunRecord,
  RefereeDecision,
  RunReviewStatus,
  SessionClaims,
  StoredCrWarClock,
} from "../types.js";
import { requireObject } from "../validation.js";
// Everything a route dispatch needs: the raw request, the cold-start config, and
// the repository bound to it. Routes take this instead of reaching for module
// globals so the routing table in app.ts stays the only wiring.
export interface RouteContext {
  request: HttpRequest;
  config: Config;
  repository: Repository;
}
export const MAGIC_LINK_SECONDS = 15 * 60;
// A login lasts 28 days. Sessions slide: /auth/refresh re-issues a fresh 28-day
// token whenever an active player returns, so a stored credential keeps working
// until it sits unused for 28 days.
const SESSION_SECONDS = 28 * 24 * 60 * 60;
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
// The HTTP server resolves proxy trust once. Domain routes never parse public
// forwarding headers or share request identity through module state.
export function clientIp(request: HttpRequest): string {
  return request.sourceIp;
}
export function clientIpHash(request: HttpRequest): string {
  return sha256(clientIp(request));
}
export function bodyOf(request: HttpRequest): Record<string, unknown> {
  if (!request.body) return {};
  try {
    return requireObject(JSON.parse(request.body) as unknown);
  } catch (error) {
    throw badRequest(error);
  }
}
export function issueSession(
  sub: string,
  secret: string,
  nowSeconds: number,
): {
  token: string;
  expiresAt: string;
} {
  const claims: SessionClaims = {
    type: "session",
    sub,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_SECONDS,
  };
  return {
    token: signToken(claims, secret),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
export function sessionFor(
  request: HttpRequest,
  secret: string,
  required: true,
): SessionClaims;
export function sessionFor(
  request: HttpRequest,
  secret: string,
  required?: false,
): SessionClaims | undefined;
export function sessionFor(
  request: HttpRequest,
  secret: string,
  required = false,
): SessionClaims | undefined {
  const token = bearerToken(request.headers.authorization);
  if (!token) {
    if (required)
      throw new HttpError(
        401,
        "Sign in to continue.",
        "authentication_required",
      );
    return undefined;
  }
  try {
    return verifyToken(token, "session", secret);
  } catch {
    throw new HttpError(
      401,
      "Your session has expired. Sign in again.",
      "invalid_session",
    );
  }
}
// The owner's view of their Elixir connection: what was offered, what was
// chosen, and how old the verification fact is. Elixir's account id stays
// internal.
export function ownerElixir(link: ElixirLink) {
  return {
    linkedAt: link.linkedAt,
    checkedAt: link.checkedAt,
    playerTag: link.playerTag,
    playerName: link.playerName,
    verified: link.verified,
    verifiedAt: link.verifiedAt,
    candidates: link.candidates,
    ...(link.trackRefused ? { trackRefused: link.trackRefused } : {}),
  };
}
export function profileResponse(
  profile: {
    sub: string;
    playerId: string;
    email: string;
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    elixir?: ElixirLink;
    elixirVerified?: boolean;
    totalGames: number;
    xp?: number;
    createdAt: string;
    updatedAt: string;
    lastOpenedUpdates?: string;
  },
  crProfile?: CrProfileSnapshot,
  rankedAccess: "allowed" | "restricted" = "allowed",
) {
  const accountTags = accountTagsFor(profile);
  return {
    id: profile.playerId,
    email: profile.email,
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    ...(accountTags.length ? { accountTags } : {}),
    ...(profile.elixir ? { elixir: ownerElixir(profile.elixir) } : {}),
    ...(profile.playerTag
      ? { clashRoyale: publicCrProfile(profile.playerTag, crProfile) }
      : {}),
    totalGames: profile.totalGames,
    xp: profile.xp ?? 0,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...(profile.lastOpenedUpdates
      ? { lastOpenedUpdates: profile.lastOpenedUpdates }
      : {}),
    rankedAccess,
    ...levelForGames(profile.totalGames),
  };
}
// Map storage run rows onto the RunRecord contract: raw history rows carry
// table keys, GSI keys, and the email-hash sub, none of which belong on the
// wire.
export function ownerRunReviewStatus(
  decision: RefereeDecision | undefined,
): RunReviewStatus | undefined {
  // The owner's history is the one surface that distinguishes "no referee has
  // looked at this" from "a referee cleared it", so it keeps the classifier's
  // undefined rather than defaulting to reviewed the way the boards do.
  return refereeReviewStatus(decision);
}
const PLAYER_REVIEW_EXPLANATIONS = {
  automated_input:
    "This run was excluded because its answer pattern was consistent with automated input rather than a person choosing each answer.",
  response_timing:
    "This run was excluded because its recorded response timing was not consistent with human play.",
  altered_play_record:
    "This run was excluded because its submitted play record was consistent with replay or programmatic alteration.",
  ranked_rules:
    "This run was excluded because the recorded play did not follow the ranked game rules.",
  combined_evidence:
    "This run was excluded because multiple parts of its timing and answer record were not consistent with human play.",
} as const;
export function ownerRunReviewExplanation(
  decision: RefereeDecision | undefined,
): string | undefined {
  if (
    decision?.visibility !== "hidden" ||
    decision.decidedBy !== "fair-play-referee" ||
    decision.queueState === "pending"
  )
    return undefined;
  return decision.playerExplanationCode
    ? PLAYER_REVIEW_EXPLANATIONS[decision.playerExplanationCode]
    : "This run was excluded after Fair Play review because it did not meet the requirements for human ranked play.";
}
export function runRecordResponse(
  run: RunRecord,
  reviewStatus?: RunReviewStatus,
  reviewExplanation?: string,
) {
  return {
    runId: run.runId,
    mode: run.mode,
    score: run.score,
    seasonId: run.seasonId,
    completedAt: run.completedAt,
    ...(run.xp !== undefined ? { xp: run.xp } : {}),
    ...(run.xpAwards?.length ? { xpAwards: run.xpAwards } : {}),
    ...(run.rungs?.length ? { rungs: run.rungs } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(reviewExplanation ? { reviewExplanation } : {}),
  };
}
// The bridge used to push this every five minutes forever. Reading it
// on demand behind the same interval costs a call only when somebody is
// actually using Drop, and the stored clock is the cache.
const WAR_CLOCK_TTL_MS = 5 * 60 * 1000;
export async function currentWarClock(
  repository: Repository,
  config?: Config,
): Promise<StoredCrWarClock | undefined> {
  let stored: StoredCrWarClock | undefined;
  try {
    stored = await repository.getCrWarClock();
  } catch (error) {
    console.warn("CR war clock lookup failed; using calendar fallback", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
  if (!config?.elixirMcpKey) return stored;
  const observedAt = stored?.observedAt ? Date.parse(stored.observedAt) : 0;
  if (Number.isFinite(observedAt) && Date.now() - observedAt < WAR_CLOCK_TTL_MS)
    return stored;
  // Reads serve cached/calendar data while a durable, serialized worker refreshes.
  await enqueueRefresh(config, { version: 1, type: "war-clock" });
  return stored;
}
