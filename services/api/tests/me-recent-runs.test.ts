import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listRecentRuns: vi.fn(),
  getCardStats: vi.fn(),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getProfile = repository.getProfile;
    listRecentRuns = repository.listRecentRuns;
    getCardStats = repository.getCardStats;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const sub = "player-sub";

function meEvent(): APIGatewayProxyEventV2 {
  const session = signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3_600 },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/me",
    rawQueryString: "",
    headers: { authorization: `Bearer ${session}` },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/me",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-me",
      routeKey: "$default",
      stage: "$default",
      time: "20/Jul/2026:01:00:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe("GET /me recent runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.getCardStats.mockResolvedValue({});
    repository.getProfile.mockResolvedValue({
      sub,
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      totalGames: 6,
      xp: 120,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
  });

  it("drops retired-mode runs so the response never carries a mode the client rejects", async () => {
    // A real player's history can still contain the deleted "vaulted" modes.
    repository.listRecentRuns.mockResolvedValue([
      {
        runId: "r1",
        mode: "surge",
        score: 15_000,
        seasonId: "2026-07",
        completedAt: "2026-07-19T18:00:00.000Z",
      },
      {
        runId: "r2",
        mode: "identify",
        score: 20_000,
        seasonId: "2026-07",
        completedAt: "2026-07-19T17:00:00.000Z",
      },
      {
        runId: "r3",
        mode: "blitz",
        score: 40,
        seasonId: "2026-07",
        completedAt: "2026-07-19T16:00:00.000Z",
      },
      {
        runId: "r4",
        mode: "survival",
        score: 12,
        seasonId: "2026-07",
        completedAt: "2026-07-19T15:00:00.000Z",
      },
    ]);

    const result = await handler(meEvent(), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.recentRuns.map((run: { mode: string }) => run.mode)).toEqual([
      "surge",
      "survival",
    ]);
  });
});
