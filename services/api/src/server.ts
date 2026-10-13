import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { HttpError } from "./errors.js";
import { json, type HttpRequest, type HttpResponse } from "./http.js";

// Preserve the former 10 MB transport ceiling, including valid Practice
// transcripts and the existing 2 MB PNG-in-JSON upload contract.
export const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_ORIGINS = [
  "https://drop.poapkings.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];
export interface ServerOptions {
  dispatch: (request: HttpRequest) => Promise<HttpResponse>;
  trustCloudFront?: boolean;
  allowedOrigins?: string[];
}
export function requestIp(
  request: IncomingMessage,
  trustCloudFront: boolean,
): string {
  if (trustCloudFront) {
    // The origin policy denies invocation outside our distribution, whose
    // viewer function overwrites this header on every dynamic behavior.
    const viewer = request.headers["x-elixir-drop-viewer-ip"];
    if (typeof viewer !== "string" || !isIP(viewer)) {
      throw new HttpError(
        400,
        "Missing trusted viewer address.",
        "invalid_proxy",
      );
    }
    return viewer;
  }
  return request.socket.remoteAddress ?? "unknown";
}
async function bodyOf(request: IncomingMessage): Promise<string | undefined> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large.", "body_too_large");
  }
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of request) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part as string);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES)
      throw new HttpError(413, "Request body is too large.", "body_too_large");
    parts.push(buffer);
  }
  return bytes ? Buffer.concat(parts).toString("utf8") : undefined;
}
export function httpServer(options: ServerOptions): Server {
  const origins = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  const server = createServer(async (incoming, outgoing) => {
    const origin = incoming.headers.origin;
    const cors: Record<string, string> =
      origin && origins.has(origin)
        ? {
            "access-control-allow-origin": origin,
            "access-control-allow-methods":
              "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
            "access-control-allow-headers": "authorization,content-type",
            "access-control-max-age": "300",
            vary: "Origin",
          }
        : {};
    let response: HttpResponse;
    try {
      if (origin && !origins.has(origin))
        throw new HttpError(
          403,
          "Origin is not allowed.",
          "origin_not_allowed",
        );
      const url = new URL(incoming.url ?? "/", "http://localhost");
      const sourceIp = requestIp(incoming, options.trustCloudFront ?? false);
      const headers = Object.fromEntries(
        Object.entries(incoming.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(",") : value,
        ]),
      );
      response = await options.dispatch({
        method: incoming.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        sourceIp,
        requestId:
          options.trustCloudFront &&
          typeof headers["lambda-web-request-id"] === "string"
            ? headers["lambda-web-request-id"]
            : randomUUID(),
        body: await bodyOf(incoming),
      });
    } catch (error) {
      const safe =
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "The API could not complete the request.",
              "internal_error",
            );
      response = json(safe.statusCode, {
        error: { code: safe.code, message: safe.message },
      });
    }
    if (outgoing.destroyed) return;
    outgoing.writeHead(response.statusCode, {
      "x-content-type-options": "nosniff",
      ...response.headers,
      ...cors,
    });
    outgoing.end(
      incoming.method === "HEAD"
        ? undefined
        : (response.bytes ?? response.body),
    );
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 20_000;
  return server;
}
export function listenAddress(
  value = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? "127.0.0.1:3000",
) {
  const separator = value.lastIndexOf(":");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (separator < 1 || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid HTTP listen address");
  return { host, port };
}
