import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
} from "aws-lambda";
import { loadConfig } from "./config.js";
import { HttpError } from "./errors.js";
import { json } from "./http.js";
import { Repository } from "./repository.js";
import {
  pollSession,
  redeemMagicLink,
  refreshSession,
  requestMagicLink,
} from "./routes/auth.js";
import type { RouteContext } from "./routes/context.js";
import {
  createNameOptions,
  deleteMe,
  getMe,
  getMySeasons,
  getPublicPlayer,
  patchMe,
} from "./routes/me.js";
import {
  getActivity,
  getLeaderboards,
  getSeasons,
  getStats,
} from "./routes/public-reads.js";
import { completeRun } from "./routes/runs-complete.js";
import { reportRunFailure } from "./routes/run-reports.js";
import { startRun } from "./routes/runs-start.js";
import { createShare, getShare } from "./routes/shares.js";

const PUBLIC_PLAYER_PATH = /^\/players\/([^/]+)$/;
const RUN_SHARE_PATH = /^\/runs\/([^/]+)\/share$/;
const SHARE_PATH = /^\/shares\/([^/]+)$/;

// The routing table. Every branch is one line: the handling lives in
// ./routes/*, one module per group of related endpoints.
async function route(event: APIGatewayProxyEventV2) {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method === "OPTIONS") return { statusCode: 204 };
  if (method === "GET" && path === "/health")
    return json(200, { ok: true, service: "elixir-drop-api" });

  const config = loadConfig();
  return handleEvent(event, {
    event,
    config,
    repository: new Repository(config.tableName),
  });
}

// The dispatch table, given a fully-built context. Split out from `route` as a
// tiny dependency-injection seam: the local dev harness (services/api/dev/) can
// hand it an in-memory repository + config instead of the DynamoDB-backed
// defaults `route` builds above. Production always reaches this through `route`
// with the real Repository, so its behavior is unchanged.
export async function handleEvent(
  event: APIGatewayProxyEventV2,
  context: RouteContext,
) {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === "POST" && path === "/auth/request")
    return requestMagicLink(context);
  if (method === "POST" && path === "/auth/poll") return pollSession(context);
  if (method === "POST" && path === "/auth/redeem")
    return redeemMagicLink(context);
  if (method === "POST" && path === "/auth/refresh")
    return refreshSession(context);

  if (method === "GET" && path === "/me") return getMe(context);
  if (method === "GET" && path === "/me/seasons") return getMySeasons(context);
  const publicPlayerMatch =
    method === "GET" ? PUBLIC_PLAYER_PATH.exec(path) : null;
  if (publicPlayerMatch)
    return getPublicPlayer(context, publicPlayerMatch[1] ?? "");
  if (method === "POST" && path === "/me/name-options")
    return createNameOptions(context);
  if (method === "DELETE" && path === "/me") return deleteMe(context);
  if (method === "PATCH" && path === "/me") return patchMe(context);

  if (method === "POST" && path === "/runs/start") return startRun(context);
  if (method === "POST" && path === "/runs/complete")
    return completeRun(context);
  if (method === "POST" && path === "/run-reports")
    return reportRunFailure(context);
  const runShareMatch = method === "POST" ? RUN_SHARE_PATH.exec(path) : null;
  if (runShareMatch) return createShare(context, runShareMatch[1] ?? "");
  const shareMatch = method === "GET" ? SHARE_PATH.exec(path) : null;
  if (shareMatch) return getShare(context, shareMatch[1] ?? "");

  if (method === "GET" && path === "/leaderboards")
    return getLeaderboards(context);
  if (method === "GET" && path === "/seasons") return getSeasons(context);
  if (method === "GET" && path === "/activity") return getActivity(context);
  if (method === "GET" && path === "/stats") return getStats(context);

  throw new HttpError(404, "Route not found.", "not_found");
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    return await route(event);
  } catch (error) {
    const safeError =
      error instanceof HttpError
        ? error
        : new HttpError(
            500,
            "The API could not complete the request.",
            "internal_error",
          );
    const logContext = {
      requestId: event.requestContext.requestId,
      method: event.requestContext.http.method,
      path: event.rawPath,
      statusCode: safeError.statusCode,
      code: safeError.code,
      error: error instanceof Error ? error.name : "unknown",
      reason: error instanceof HttpError ? error.message : undefined,
    };
    if (safeError.statusCode >= 500) {
      console.error("API request failed", logContext);
    } else {
      console.warn("API request rejected", logContext);
    }
    return json(safeError.statusCode, {
      error: { code: safeError.code, message: safeError.message },
    });
  }
};

export { crResultHandler } from "./cr-results.js";
export { mailCanaryHandler } from "./mail-canary.js";
