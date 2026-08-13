import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const JSON_LIMIT = 16_384;
const IDENTIFIER = /^[#A-Za-z0-9-]{3,128}$/;
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export type ScriptRunner = (
  script: string,
  args?: string[],
) => Promise<Record<string, unknown>>;

export type AdminServerOptions = {
  repoRoot: string;
  staticRoot: string;
  allowedLogin: string;
  devBypassIdentity?: boolean;
  runner?: ScriptRunner;
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function operatorFor(
  request: IncomingMessage,
  options: AdminServerOptions,
): string | undefined {
  if (options.devBypassIdentity) return "local-development";
  const login = request.headers["tailscale-user-login"];
  const normalized = Array.isArray(login) ? login[0] : login;
  return normalized && safeEqual(normalized, options.allowedLogin)
    ? normalized
    : undefined;
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_LIMIT) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JSON object required");
  return value as Record<string, unknown>;
}

function sameOrigin(request: IncomingMessage): boolean {
  const source = request.headers.origin ?? request.headers.referer;
  if (!source || !request.headers.host) return false;
  try {
    return new URL(source).host === request.headers.host;
  } catch {
    return false;
  }
}

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error("Invalid identifier");
  return value;
}

function stringField(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  )
    throw new Error(`${name} must contain ${minimum}..${maximum} characters`);
  return value.trim();
}

export function defaultScriptRunner(repoRoot: string): ScriptRunner {
  return async (script, args = []) => {
    const path = join(repoRoot, "AGENT-TEAM", "scripts", script);
    try {
      const result = await execFileAsync(process.execPath, [path, ...args], {
        cwd: repoRoot,
        env: process.env,
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return JSON.parse(result.stdout) as Record<string, unknown>;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      if (failure.stdout) {
        try {
          const envelope = JSON.parse(failure.stdout) as {
            detail?: string;
            reason?: string;
          };
          throw new Error(
            envelope.detail ?? envelope.reason ?? "Referee command failed",
          );
        } catch (parseError) {
          if (parseError instanceof SyntaxError)
            throw new Error("Referee command returned invalid output");
          throw parseError;
        }
      }
      throw new Error(
        failure.stderr?.trim() || failure.message || "Referee command failed",
      );
    }
  };
}

function decisionArguments(
  runId: string,
  input: Record<string, unknown>,
): string[] {
  const action = input.action;
  const reason = stringField(input.reason, "reason", 8, 1_000);
  if (action === "reopen")
    return [runId, "--reopen", "--approved-by", "jamie", "--reason", reason];
  if (action === "exclude") {
    const playerReason = stringField(input.playerReason, "playerReason", 3, 64);
    const allowed = new Set([
      "automated_input",
      "response_timing",
      "altered_play_record",
      "ranked_rules",
      "combined_evidence",
    ]);
    if (!allowed.has(playerReason)) throw new Error("Invalid player reason");
    return [
      runId,
      "--disposition",
      "review",
      "--visibility",
      "hidden",
      "--reason",
      reason,
      "--player-reason",
      playerReason,
    ];
  }
  if (action === "clear" || action === "watch")
    return [
      runId,
      "--disposition",
      action,
      "--visibility",
      "visible",
      "--reason",
      reason,
    ];
  if (action === "insufficient") {
    const visibility =
      input.visibility === "not_ranked" ? "not_ranked" : "visible";
    return [
      runId,
      "--disposition",
      "insufficient_evidence",
      "--visibility",
      visibility,
      "--reason",
      reason,
    ];
  }
  throw new Error("Invalid decision action");
}

function accessArguments(
  playerId: string,
  input: Record<string, unknown>,
): string[] {
  const status = input.status;
  if (status !== "allowed" && status !== "restricted")
    throw new Error("Invalid ranked access status");
  const reason = stringField(input.reason, "reason", 12, 1_000);
  return [
    playerId,
    status === "restricted" ? "--restrict" : "--restore",
    "--approved-by",
    "jamie",
    "--reason",
    reason,
  ];
}

export function createAdminServer(options: AdminServerOptions): Server {
  const csrfToken = randomBytes(32).toString("base64url");
  const run = options.runner ?? defaultScriptRunner(options.repoRoot);

  return createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
      if (url.pathname === "/healthz")
        return json(response, 200, { status: "ok" });
      const operator = operatorFor(request, options);
      if (!operator)
        return json(response, 401, { error: "tailnet_identity_required" });

      if (request.method === "POST") {
        const token = request.headers["x-drop-admin-csrf"];
        const supplied = Array.isArray(token) ? token[0] : token;
        if (
          !supplied ||
          !safeEqual(supplied, csrfToken) ||
          !sameOrigin(request)
        )
          return json(response, 403, { error: "request_verification_failed" });
      }

      if (request.method === "GET" && url.pathname === "/api/overview") {
        const directory = await run("referee-players.mjs", ["--limit", "1000"]);
        return json(response, 200, {
          ...directory,
          operator,
          csrfToken,
        });
      }

      const playerMatch = url.pathname.match(/^\/api\/players\/([^/]+)$/);
      if (request.method === "GET" && playerMatch?.[1])
        return json(
          response,
          200,
          await run("referee-player.mjs", [
            identifier(decodeURIComponent(playerMatch[1])),
          ]),
        );

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch?.[1])
        return json(
          response,
          200,
          await run("referee-run.mjs", [
            identifier(decodeURIComponent(runMatch[1])),
          ]),
        );

      const decisionMatch = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/decision$/,
      );
      if (request.method === "POST" && decisionMatch?.[1]) {
        const runId = identifier(decodeURIComponent(decisionMatch[1]));
        await run(
          "referee-decide.mjs",
          decisionArguments(runId, await body(request)),
        );
        return json(response, 200, await run("referee-run.mjs", [runId]));
      }

      const accessMatch = url.pathname.match(
        /^\/api\/players\/([^/]+)\/ranked-access$/,
      );
      if (request.method === "POST" && accessMatch?.[1]) {
        const playerId = identifier(decodeURIComponent(accessMatch[1]));
        await run(
          "referee-ranked-access.mjs",
          accessArguments(playerId, await body(request)),
        );
        return json(response, 200, await run("referee-player.mjs", [playerId]));
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const requested =
          url.pathname === "/"
            ? "index.html"
            : normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
        let path = resolve(options.staticRoot, requested);
        if (
          !path.startsWith(`${resolve(options.staticRoot)}/`) &&
          path !== resolve(options.staticRoot, "index.html")
        )
          return json(response, 404, { error: "not_found" });
        if (!existsSync(path) || !statSync(path).isFile())
          path = resolve(options.staticRoot, "index.html");
        if (!existsSync(path))
          return json(response, 503, { error: "admin_app_not_built" });
        response.writeHead(200, {
          "Cache-Control": path.endsWith("index.html")
            ? "no-store"
            : "public, max-age=3600",
          "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
          "Content-Security-Policy":
            "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        });
        if (request.method === "HEAD") return response.end();
        return createReadStream(path).pipe(response);
      }

      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      const status = /Invalid|must|required|JSON|too large/.test(detail)
        ? 400
        : 502;
      return json(response, status, {
        error: status === 400 ? "invalid_request" : "referee_unavailable",
        detail,
      });
    }
  });
}
