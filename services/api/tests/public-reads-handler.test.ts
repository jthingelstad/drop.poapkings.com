import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  useRateLimit: vi.fn(),
  getCrWarClock: vi.fn(),
  recentActivity: vi.fn(),
  globalStats: vi.fn(),
  leaderboard: vi.fn(),
  allTimeLeaderboard: vi.fn(),
}));

vi.mock("../src/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/repository.js")>();
  return {
    ACTIVITY_WINDOW_HOURS: actual.ACTIVITY_WINDOW_HOURS,
    Repository: class {
      useRateLimit = repository.useRateLimit;
      getCrWarClock = repository.getCrWarClock;
      recentActivity = repository.recentActivity;
      globalStats = repository.globalStats;
      leaderboard = repository.leaderboard;
      allTimeLeaderboard = repository.allTimeLeaderboard;
    },
  };
});

import { HttpError } from "../src/errors.js";
import { handler } from "../src/handler.js";

function request(
  method: string,
  path: string,
  query = "",
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: query,
    headers: {},
    queryStringParameters: query
      ? Object.fromEntries(new URLSearchParams(query))
      : undefined,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-public",
      routeKey: "$default",
      stage: "$default",
      time: "19/Jul/2026:01:00:00 +0000",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function call(event: APIGatewayProxyEventV2) {
  const result = await handler(event, {} as never, () => {});
  if (!result || typeof result === "string") throw new Error("no result");
  return {
    statusCode: result.statusCode,
    body: JSON.parse(result.body ?? "{}") as Record<string, unknown>,
  };
}

// The unauthenticated surface. Every one of these is reachable by anyone with
// the URL, so each must charge the read budget and answer a hostile query
// string with a 4xx rather than a stack trace.
describe("public read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    process.env.WEB_VERSION = "abc123def456";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.recentActivity.mockResolvedValue([]);
    repository.globalStats.mockResolvedValue({ trophyRoadGames: 640 });
  });

  it("answers the health check without touching config or storage", async () => {
    const result = await call(request("GET", "/health"));

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ ok: true, service: "elixir-drop-api" });
    expect(repository.useRateLimit).not.toHaveBeenCalled();
  });

  it("short-circuits a CORS preflight", async () => {
    const result = await handler(
      request("OPTIONS", "/runs/start"),
      {} as never,
      () => {},
    );

    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(204);
  });

  it("answers an unknown path with a 404 code, not a 500", async () => {
    const result = await call(request("GET", "/nope"));

    expect(result.statusCode).toBe(404);
    expect(result.body).toMatchObject({ error: { code: "not_found" } });
  });

  it("serves the site stats with the deployed web build id", async () => {
    const result = await call(request("GET", "/stats"));

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      trophyRoadGames: 640,
      webVersion: "abc123def456",
    });
    expect(result.body.currentSeason).toBeDefined();
    expect(repository.useRateLimit).toHaveBeenCalledWith(
      "reads",
      expect.any(String),
      1200,
      60 * 60,
    );
  });

  it("serves the current season and the next three", async () => {
    const result = await call(request("GET", "/seasons"));

    expect(result.statusCode).toBe(200);
    expect(result.body.current).toBeDefined();
    expect(result.body.upcoming).toHaveLength(3);
  });

  it("uses the default activity limit when none is given", async () => {
    await call(request("GET", "/activity"));

    expect(repository.recentActivity).toHaveBeenCalledWith(
      expect.any(String),
      8,
    );
  });

  it("clamps an oversized activity limit to the visible maximum", async () => {
    const result = await call(request("GET", "/activity", "limit=9999"));

    expect(repository.recentActivity).toHaveBeenCalledWith(
      expect.any(String),
      25,
    );
    expect(result.body.windowHours).toBe(24);
  });

  it("clamps a zero or negative activity limit to one", async () => {
    await call(request("GET", "/activity", "limit=-5"));

    expect(repository.recentActivity).toHaveBeenCalledWith(
      expect.any(String),
      1,
    );
  });

  it("falls back to the default when the activity limit is not a number", async () => {
    await call(request("GET", "/activity", "limit=all"));

    expect(repository.recentActivity).toHaveBeenCalledWith(
      expect.any(String),
      8,
    );
  });

  it("rejects a leaderboard request for a mode that does not exist", async () => {
    const result = await call(request("GET", "/leaderboards", "mode=chess"));

    expect(result.statusCode).toBe(400);
    expect(repository.leaderboard).not.toHaveBeenCalled();
  });

  it("rejects a malformed season id before it reaches storage", async () => {
    const result = await call(
      request("GET", "/leaderboards", "mode=surge&season=../../etc"),
    );

    expect(result.statusCode).toBe(400);
    expect(repository.leaderboard).not.toHaveBeenCalled();
  });

  it("accepts a mid-month season id with an explicit CR suffix", async () => {
    repository.leaderboard.mockResolvedValue([]);

    const result = await call(
      request("GET", "/leaderboards", "mode=surge&season=2026-07-136"),
    );

    expect(result.statusCode).toBe(200);
    expect(repository.leaderboard).toHaveBeenCalledWith("surge", "2026-07-136");
  });

  it("keeps serving seasons when the war clock read fails", async () => {
    repository.getCrWarClock.mockRejectedValue(new Error("dynamo down"));

    const result = await call(request("GET", "/seasons"));

    expect(result.statusCode).toBe(200);
    expect(result.body.current).toBeDefined();
  });

  it("charges the read budget before doing the work, and stops when it is spent", async () => {
    repository.useRateLimit.mockRejectedValue(
      new HttpError(429, "Too many requests. Try again later.", "rate_limited"),
    );

    const result = await call(request("GET", "/stats"));

    expect(result.statusCode).toBe(429);
    expect(result.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(repository.globalStats).not.toHaveBeenCalled();
  });
});
