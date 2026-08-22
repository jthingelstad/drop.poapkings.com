import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// Local dev API. Sets the required env BEFORE anything reads config, then runs
// the REAL request handler against an in-memory repository. NOT for production.
const DEFAULTS: Record<string, string> = {
  TABLE_NAME: "elixir-drop-dev",
  SESSION_SECRET: "dev-session-secret-stable-across-restarts",
  TELEMETRY_PEPPER: "dev-telemetry-pepper",
  APP_URL: "http://localhost:5173",
  FASTMAIL_JMAP_TOKEN: "dev",
  CR_REQUEST_QUEUE_URL: "dev",
  ELIXIR_DROP_DEV_MAIL: "console",
};
for (const [key, value] of Object.entries(DEFAULTS))
  if (!process.env[key]) process.env[key] = value;

const { handleEvent } = await import("../src/handler.js");
const { loadConfig } = await import("../src/config.js");
const { HttpError } = await import("../src/errors.js");
const { recentSeasons } = await import("../src/seasons.js");
const { InMemoryRepository } = await import("./in-memory-repository.js");
const { Repository } = await import("../src/repository.js");

const config = loadConfig();
const repository = new InMemoryRepository();
repository.seed(recentSeasons(new Date(), 4).map((s) => s.id));

const PORT = Number(process.env.PORT ?? 8787);
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true, service: "elixir-drop-api-dev" }));
    return;
  }

  const rawBody = await readBody(req);
  const event = {
    version: "2.0",
    routeKey: "$default",
    rawPath: url.pathname,
    rawQueryString: url.search.replace(/^\?/, ""),
    headers: req.headers as Record<string, string>,
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: {
      http: { method, path: url.pathname, sourceIp: "127.0.0.1" },
      requestId: randomUUID(),
    },
    body: rawBody || undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;

  try {
    const result = await handleEvent(event, {
      event,
      config,
      // The in-memory store is structurally incompatible with the real class
      // (private fields); the cast is expected for the dev harness.
      repository: repository as unknown as InstanceType<typeof Repository>,
    });
    res.writeHead(result.statusCode, { ...result.headers, ...CORS });
    res.end(result.body ?? "");
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    const code =
      error instanceof HttpError ? error.code : "internal_error";
    const message =
      error instanceof HttpError
        ? error.message
        : "The dev API could not complete the request.";
    if (status >= 500) console.error("[dev api] unhandled error", error);
    res.writeHead(status, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: { code, message } }));
  }
});

server.listen(PORT, () => {
  console.log(
    `\n🧪 Elixir Drop dev API on http://localhost:${PORT}  (in-memory, seeded)\n` +
      `   Point the web app at it: LOCAL_API=1 npm --workspace apps/web run dev\n` +
      `   Sign in: enter any email; the magic link prints here in the terminal.\n`,
  );
});
