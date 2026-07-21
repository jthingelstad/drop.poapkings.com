import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  leaderboard: vi.fn(),
  allTimeLeaderboard: vi.fn(),
  getCrWarClock: vi.fn(),
  useRateLimit: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    leaderboard = repository.leaderboard;
    allTimeLeaderboard = repository.allTimeLeaderboard;
    getCrWarClock = repository.getCrWarClock;
    useRateLimit = repository.useRateLimit;
  },
}));

import { handler } from "../src/handler.js";

const nowSeconds = Math.floor(Date.now() / 1_000);

function leaderboardEvent(query: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/leaderboards",
    rawQueryString: query,
    headers: {},
    queryStringParameters: Object.fromEntries(new URLSearchParams(query)),
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/leaderboards",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-lb",
      routeKey: "$default",
      stage: "$default",
      time: "19/Jul/2026:01:00:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

const sampleRows = [
  {
    rank: 1,
    score: 11_000,
    achievedAt: "2026-06-01T12:00:00.000Z",
    player: {
      id: "p-a",
      publicName: "Ace",
      totalGames: 9,
      xp: 400,
      level: 3,
    },
  },
];

describe("GET /leaderboards scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.leaderboard.mockResolvedValue(sampleRows);
    repository.allTimeLeaderboard.mockResolvedValue(sampleRows);
  });

  it("returns the all-time board when scope=all-time", async () => {
    const result = await handler(
      leaderboardEvent("mode=surge&scope=all-time"),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(repository.allTimeLeaderboard).toHaveBeenCalledWith("surge");
    expect(repository.leaderboard).not.toHaveBeenCalled();
    expect(body.scope).toBe("all-time");
    expect(body.seasonId).toBeUndefined();
    expect(body.currentSeason).toBeDefined();
    expect(body.entries).toEqual(sampleRows);
  });

  it("returns the season board by default and labels its scope", async () => {
    const result = await handler(
      leaderboardEvent("mode=surge"),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(repository.leaderboard).toHaveBeenCalledOnce();
    expect(repository.allTimeLeaderboard).not.toHaveBeenCalled();
    expect(body.scope).toBe("season");
    expect(typeof body.seasonId).toBe("string");
  });
});
