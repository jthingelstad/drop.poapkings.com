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
  getMyXp,
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
import { createInviteShare, getShare } from "./routes/shares.js";
import {
  createPublishedBadgeShare,
  getPublishedBadgeImage,
  getPublishedBadgePage,
  uploadPublishedBadgeImage,
} from "./routes/published-badges.js";
import {
  createPublishedRunShare,
  getPublishedRunImage,
  getPublishedRunPage,
  openPublishedRunShare,
  uploadPublishedRunImage,
} from "./routes/published-shares.js";
import {
  createPublishedProfileShare,
  getPublishedProfileImage,
  getPublishedProfilePage,
  uploadPublishedProfileImage,
} from "./routes/published-profiles.js";

const PUBLIC_PLAYER_PATH = /^\/players\/([^/]+)$/;
const RUN_SHARE_PATH = /^\/runs\/([^/]+)\/share$/;
const SHARE_PATH = /^\/shares\/([^/]+)$/;
const PUBLISHED_SHARE_PATH = /^\/share\/([^/]+)\/([^/]+)$/;
const PUBLISHED_SHARE_OPEN_PATH = /^\/share\/([^/]+)\/([^/]+)\/open$/;
const PUBLISHED_SHARE_IMAGE_PATH = /^\/share-assets\/([^/]+)\/([^/]+)$/;
const BADGE_SHARE_PATH = /^\/badges\/([^/]+)\/share$/;
const PUBLISHED_BADGE_PATH = /^\/share\/([^/]+)\/badge\/([^/]+)\/([^/]+)$/;
const PUBLISHED_BADGE_IMAGE_PATH =
  /^\/share-assets\/([^/]+)\/badge\/([^/]+)\/([^/]+)$/;
const PUBLISHED_PROFILE_PATH = /^\/share\/([^/]+)$/;
const PUBLISHED_PROFILE_IMAGE_PATH = /^\/share-assets\/([^/]+)$/;

// The routing table. Every branch is one line: the handling lives in
// ./routes/*, one module per group of related endpoints.
async function route(event: APIGatewayProxyEventV2) {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method === "OPTIONS") return { statusCode: 204 };
  if (method === "GET" && path === "/health")
    return json(200, { ok: true, service: "elixir-drop-api" });

  const config = loadConfig();
  const context: RouteContext = {
    event,
    config,
    repository: new Repository(config.tableName),
  };

  if (method === "POST" && path === "/auth/request")
    return requestMagicLink(context);
  if (method === "POST" && path === "/auth/poll") return pollSession(context);
  if (method === "POST" && path === "/auth/redeem")
    return redeemMagicLink(context);
  if (method === "POST" && path === "/auth/refresh")
    return refreshSession(context);

  if (method === "GET" && path === "/me") return getMe(context);
  if (method === "GET" && path === "/me/seasons") return getMySeasons(context);
  if (method === "GET" && path === "/me/xp") return getMyXp(context);
  if (method === "POST" && path === "/me/share")
    return createPublishedProfileShare(context);
  if (method === "PUT" && path === "/me/share")
    return uploadPublishedProfileImage(context);
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
  if (runShareMatch)
    return createPublishedRunShare(context, runShareMatch[1] ?? "");
  const runShareUploadMatch =
    method === "PUT" ? RUN_SHARE_PATH.exec(path) : null;
  if (runShareUploadMatch)
    return uploadPublishedRunImage(context, runShareUploadMatch[1] ?? "");
  const badgeShareMatch = BADGE_SHARE_PATH.exec(path);
  if (badgeShareMatch && method === "POST")
    return createPublishedBadgeShare(context, badgeShareMatch[1] ?? "");
  if (badgeShareMatch && method === "PUT")
    return uploadPublishedBadgeImage(context, badgeShareMatch[1] ?? "");
  if (method === "POST" && path === "/shares")
    return createInviteShare(context);
  const shareMatch = method === "GET" ? SHARE_PATH.exec(path) : null;
  if (shareMatch) return getShare(context, shareMatch[1] ?? "");
  const publishedShareMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_SHARE_PATH.exec(path)
      : null;
  if (publishedShareMatch)
    return getPublishedRunPage(
      context,
      publishedShareMatch[1] ?? "",
      publishedShareMatch[2] ?? "",
      method === "HEAD",
    );
  const publishedShareImageMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_SHARE_IMAGE_PATH.exec(path)
      : null;
  if (publishedShareImageMatch)
    return getPublishedRunImage(
      context,
      publishedShareImageMatch[1] ?? "",
      publishedShareImageMatch[2] ?? "",
      method === "HEAD",
    );
  const publishedBadgeMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_BADGE_PATH.exec(path)
      : null;
  if (publishedBadgeMatch)
    return getPublishedBadgePage(
      context,
      publishedBadgeMatch[1] ?? "",
      publishedBadgeMatch[2] ?? "",
      publishedBadgeMatch[3] ?? "",
      method === "HEAD",
    );
  const publishedBadgeImageMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_BADGE_IMAGE_PATH.exec(path)
      : null;
  if (publishedBadgeImageMatch)
    return getPublishedBadgeImage(
      context,
      publishedBadgeImageMatch[1] ?? "",
      publishedBadgeImageMatch[2] ?? "",
      publishedBadgeImageMatch[3] ?? "",
      method === "HEAD",
    );
  const publishedProfileMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_PROFILE_PATH.exec(path)
      : null;
  if (publishedProfileMatch)
    return getPublishedProfilePage(
      context,
      publishedProfileMatch[1] ?? "",
      method === "HEAD",
    );
  const publishedProfileImageMatch =
    method === "GET" || method === "HEAD"
      ? PUBLISHED_PROFILE_IMAGE_PATH.exec(path)
      : null;
  if (publishedProfileImageMatch)
    return getPublishedProfileImage(
      context,
      publishedProfileImageMatch[1] ?? "",
      method === "HEAD",
    );
  const publishedShareOpenMatch =
    method === "POST" ? PUBLISHED_SHARE_OPEN_PATH.exec(path) : null;
  if (publishedShareOpenMatch)
    return openPublishedRunShare(
      context,
      publishedShareOpenMatch[1] ?? "",
      publishedShareOpenMatch[2] ?? "",
    );

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
