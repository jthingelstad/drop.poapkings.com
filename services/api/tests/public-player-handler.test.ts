import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getPublicPlayer: vi.fn(),
  listRecentRuns: vi.fn(),
  useRateLimit: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getPublicPlayer = repository.getPublicPlayer;
    listRecentRuns = repository.listRecentRuns;
    useRateLimit = repository.useRateLimit;
  },
}));

import { handler } from "../src/handler.js";

function playerEvent(id: string): APIGatewayProxyEventV2 {
  const path = `/players/${encodeURIComponent(id)}`;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "GET",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-player",
      routeKey: "$default",
      stage: "$default",
      time: "22/Jul/2026:18:00:00 +0000",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe("GET /players/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.listRecentRuns.mockResolvedValue([
      {
        runId: "run-1",
        mode: "surge",
        score: 52_000,
        seasonId: "2026-07",
        completedAt: "2026-07-22T17:00:00.000Z",
        pk: "PLAYER#private-sub",
        sk: "RUN#private",
      },
      {
        runId: "retired-1",
        mode: "identify",
        score: 9,
        seasonId: "2025-10",
        completedAt: "2025-10-01T00:00:00.000Z",
      },
      {
        runId: "practice-1",
        mode: "practice",
        score: 0,
        seasonId: "2026-07",
        completedAt: "2026-07-22T16:00:00.000Z",
      },
    ]);
    repository.getPublicPlayer.mockResolvedValue({
      sub: "private-sub",
      player: {
        id: "player-2",
        publicName: "Royal Ghosted",
        favoriteCardId: 26000050,
        totalGames: 42,
        xp: 900,
        level: 4,
        levelStartGames: 25,
        nextLevelGames: 50,
      },
    });
  });

  it("returns only public identity and sanitized recent runs", async () => {
    const result = await handler(
      playerEvent("player-2"),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(repository.getPublicPlayer).toHaveBeenCalledWith("player-2");
    expect(repository.listRecentRuns).toHaveBeenCalledWith("private-sub", 10);
    expect(body.player).toMatchObject({
      id: "player-2",
      publicName: "Royal Ghosted",
      totalGames: 42,
    });
    expect(body.player).not.toHaveProperty("email");
    expect(body.player).not.toHaveProperty("sub");
    expect(body.recentRuns).toEqual([
      {
        runId: "run-1",
        mode: "surge",
        score: 52_000,
        seasonId: "2026-07",
        completedAt: "2026-07-22T17:00:00.000Z",
      },
    ]);
  });

  it("returns 404 when the public player id is unknown", async () => {
    repository.getPublicPlayer.mockResolvedValue(undefined);

    const result = await handler(playerEvent("missing"), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      error: { code: "player_not_found" },
    });
    expect(repository.listRecentRuns).not.toHaveBeenCalled();
  });
});
