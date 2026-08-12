import { createHash } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Config } from "../config.js";
import { publicCrProfile, requestCrProfileRefresh } from "../cr-refresh.js";
import { badRequest, HttpError } from "../errors.js";
import { bearerToken } from "../http.js";
import { levelForGames } from "../progression.js";
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
  },
  crProfile?: CrProfileSnapshot,
) {
  return {
    id: profile.playerId,
    email: profile.email,
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    ...(profile.playerTag
      ? { clashRoyale: publicCrProfile(profile.playerTag, crProfile) }
      : {}),
    totalGames: profile.totalGames,
    xp: profile.xp ?? 0,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...levelForGames(profile.totalGames),
  };
}

// Map storage run rows onto the RunRecord contract: raw history rows carry
// table keys, GSI keys, and the email-hash sub, none of which belong on the
// wire.
export function ownerRunReviewStatus(
  decision: RefereeDecision | undefined,
): RunReviewStatus | undefined {
  if (!decision) return undefined;
  if (
    decision.visibility === "hidden" &&
    decision.decidedBy === "integrity-gate"
  )
    return "pending";
  if (
    decision.visibility === "hidden" &&
    decision.decidedBy === "fair-play-referee"
  )
    return "excluded";
  if (
    decision.visibility === "visible" &&
    decision.decidedBy === "fair-play-referee"
  )
    return "reviewed";
  return undefined;
}

export function runRecordResponse(
  run: RunRecord,
  reviewStatus?: RunReviewStatus,
) {
  return {
    runId: run.runId,
    mode: run.mode,
    score: run.score,
    seasonId: run.seasonId,
    completedAt: run.completedAt,
    ...(reviewStatus ? { reviewStatus } : {}),
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
