import { runReference } from "@elixir-drop/contracts";
import { badRequest, HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { verifyToken } from "../signing.js";
import type { RunClaims } from "../types.js";
import { requireObject, requireText } from "../validation.js";
import {
  bodyOf,
  clientIpHash,
  type RouteContext,
  sessionFor,
} from "./context.js";

const FAILURE_CODE_PATTERN = /^[a-z0-9_-]{1,64}$/;
const CLIENT_BUILD_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const REPORT_CONTEXT_MAX_LENGTH = 1_000;
const REPORT_TTL_SECONDS = 180 * 24 * 60 * 60;

type VisibilityState = "hidden" | "visible" | "prerender";
type DisplayMode = "browser" | "standalone";

function optionalRunClaims(
  value: unknown,
  secret: string,
): RunClaims | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return verifyToken(value, "run", secret);
  } catch {
    return undefined;
  }
}

function failureFrom(value: unknown): {
  code: string;
  status: number;
} {
  const failure = requireObject(value, "Failure");
  if (
    typeof failure.code !== "string" ||
    !FAILURE_CODE_PATTERN.test(failure.code)
  )
    throw new Error("Failure code is invalid");
  if (
    typeof failure.status !== "number" ||
    !Number.isSafeInteger(failure.status) ||
    failure.status < 400 ||
    failure.status > 499
  )
    throw new Error("Failure status is invalid");
  return { code: failure.code, status: failure.status };
}

function clientFrom(value: unknown): {
  buildId: string;
  online: boolean;
  visibility: VisibilityState;
  displayMode: DisplayMode;
} {
  const client = requireObject(value, "Client metadata");
  if (
    typeof client.buildId !== "string" ||
    !CLIENT_BUILD_PATTERN.test(client.buildId)
  )
    throw new Error("Client build is invalid");
  if (typeof client.online !== "boolean")
    throw new Error("Client online state is invalid");
  if (
    client.visibility !== "hidden" &&
    client.visibility !== "visible" &&
    client.visibility !== "prerender"
  )
    throw new Error("Client visibility is invalid");
  if (client.displayMode !== "browser" && client.displayMode !== "standalone")
    throw new Error("Client display mode is invalid");
  return {
    buildId: client.buildId,
    online: client.online,
    visibility: client.visibility,
    displayMode: client.displayMode,
  };
}

// POST /run-reports — capture a terminal completion failure without collecting
// account identity, request headers, or play transcripts. Repeating the request
// for the same run updates the existing report, which lets the player attach
// optional context after the automatic report succeeds.
export async function reportRunFailure({
  event,
  config,
  repository,
}: RouteContext) {
  const body = bodyOf(event);
  await repository.useRateLimit(
    "run-report",
    clientIpHash(event, config.webOriginToken),
    120,
    60 * 60,
  );

  try {
    const runId = requireText(body.runId, "Run id", 100);
    const failure = failureFrom(body.failure);
    const client = clientFrom(body.client);
    const context =
      body.context === undefined
        ? undefined
        : requireText(
            body.context,
            "Report context",
            REPORT_CONTEXT_MAX_LENGTH,
          );
    const claims = optionalRunClaims(body.runToken, config.sessionSecret);
    const run = await repository.getRun(runId);
    const session = sessionFor(event, config.sessionSecret, false);

    if (claims) {
      if (claims.runId !== runId)
        throw new HttpError(403, "This report does not match its signed run.");
      if (run && (run.owner !== claims.owner || run.mode !== claims.mode))
        throw new HttpError(403, "This report does not match its signed run.");
      if (!claims.guest && (!session || session.sub !== claims.owner))
        throw new HttpError(
          403,
          "Sign in with the account that played this run.",
        );
    } else if (!run || !session || run.owner !== session.sub) {
      throw new HttpError(
        403,
        "A signed run or its signed-in owner is required to report this game.",
      );
    }

    const mode = claims?.mode ?? run?.mode;
    if (!isGameMode(mode)) throw new Error("Run mode is invalid");
    const now = new Date();
    const report = await repository.upsertRunReport({
      runId,
      runReference: runReference(runId),
      mode,
      failureCode: failure.code,
      failureStatus: failure.status,
      clientBuildId: client.buildId,
      clientOnline: client.online,
      clientVisibility: client.visibility,
      clientDisplayMode: client.displayMode,
      runFound: Boolean(run),
      runState: run?.state ?? "missing",
      guest: claims?.guest === true || run?.guest === true,
      runAgeSeconds: Math.max(
        0,
        Math.floor(now.getTime() / 1_000) -
          (claims?.iat ??
            Math.floor(new Date(run?.startedAt ?? now).getTime() / 1_000)),
      ),
      context,
      reportedAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1_000) + REPORT_TTL_SECONDS,
    });

    return json(202, {
      accepted: true,
      reportId: report.reportId,
      runReference: report.runReference,
      contextSaved: Boolean(context),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest(error);
  }
}
