import { createHash } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { accountTagsForPlayerId } from "../account-tags.js";
import type { Config } from "../config.js";
import { publicCrProfile, requestCrProfileRefresh } from "../cr-refresh.js";
import { badRequest, HttpError } from "../errors.js";
import { bearerToken } from "../http.js";
import { levelForGames } from "../progression.js";
import { refereeReviewStatus } from "../referee-status.js";
import type { Repository } from "../repository.js";
import { signToken, verifyToken } from "../signing.js";
import type {
  CrProfileSnapshot,
  RunRecord,
  RefereeDecision,
  RunReviewStatus,
  SessionClaims,
  StoredCrWarClock,
} from "../types.js";
import { requireObject } from "../validation.js";

// Everything a route handler needs: the raw event, the cold-start config, and
// the repository bound to it. Routes take this instead of reaching for module
// globals so the routing table in handler.ts stays the only wiring.
export interface RouteContext {
  event: APIGatewayProxyEventV2;
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

// The peppered per-IP identity used by every read/write rate limit.
export function clientIpHash(event: APIGatewayProxyEventV2): string {
  return sha256(event.requestContext.http.sourceIp || "unknown");
}

export function bodyOf(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    return requireObject(JSON.parse(event.body) as unknown);
  } catch (error) {
    throw badRequest(error);
  }
}

export function issueSession(
  sub: string,
  secret: string,
  nowSeconds: number,
): { token: string; expiresAt: string } {
  const claims: SessionClaims = {
    type: "session",
    sub,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_SECONDS,
  };
  return {
    token: signToken(claims, secret),
    expiresAt: new Date(claims.exp * 1_000).toISOString(),
  };
}

export function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required: true,
): SessionClaims;
export function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required?: false,
): SessionClaims | undefined;
export function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required = false,
): SessionClaims | undefined {
  const token = bearerToken(event.headers.authorization);
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

export function profileResponse(
  profile: {
    sub: string;
    playerId: string;
    email: string;
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    totalGames: number;
    xp?: number;
    createdAt: string;
    updatedAt: string;
    lastOpenedUpdates?: string;
  },
  crProfile?: CrProfileSnapshot,
  rankedAccess: "allowed" | "restricted" = "allowed",
) {
  const accountTags = accountTagsForPlayerId(profile.playerId);
  return {
    id: profile.playerId,
    email: profile.email,
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    ...(accountTags.length ? { accountTags } : {}),
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

export async function refreshedCrProfile(
  repository: Repository,
  queueUrl: string,
  tag: string | undefined,
): Promise<CrProfileSnapshot | undefined> {
  if (!tag) return undefined;
  try {
    return await requestCrProfileRefresh(repository, queueUrl, tag);
  } catch (error) {
    console.error("CR profile refresh could not be queued", {
      playerTag: tag,
      error: error instanceof Error ? error.name : "unknown",
    });
    return repository.getCrProfile(tag);
  }
}

export async function currentWarClock(
  repository: Repository,
): Promise<StoredCrWarClock | undefined> {
  try {
    return await repository.getCrWarClock();
  } catch (error) {
    console.warn("CR war clock lookup failed; using calendar fallback", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
}
