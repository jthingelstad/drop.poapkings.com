import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getCrProfile: vi.fn(),
  getPublicPlayer: vi.fn(),
  getBadges: vi.fn(),
  getCardStats: vi.fn(),
  listAllRuns: vi.fn(),
  listRecentRuns: vi.fn(),
  saveBadges: vi.fn(),
  useRateLimit: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrProfile = repository.getCrProfile;
    getPublicPlayer = repository.getPublicPlayer;
    getBadges = repository.getBadges;
    getCardStats = repository.getCardStats;
    listAllRuns = repository.listAllRuns;
    listRecentRuns = repository.listRecentRuns;
    saveBadges = repository.saveBadges;
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
    repository.getCrProfile.mockResolvedValue(undefined);
    repository.getCardStats.mockResolvedValue({});
    repository.listAllRuns.mockResolvedValue([]);
    repository.saveBadges.mockResolvedValue(true);
    repository.getBadges.mockResolvedValue({
      version: 4,
      values: { clockbreaker: 49 },
      runsAtRung: { clockbreaker: [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      aux: { modes: [], cards: [], dayStreak: 0, dayRuns: 0 },
      earned: {
        clockbreaker: ["2026-07-21T17:00:00.000Z", "2026-07-22T17:00:00.000Z"],
      },
    });
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
    expect(body.badges.badges).toContainEqual(
      expect.objectContaining({ slug: "clockbreaker", rungIndex: 1 }),
    );
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

  it("returns Clash player and clan identity without owner-only snapshot data", async () => {
    repository.getPublicPlayer.mockResolvedValue({
      sub: "private-sub",
      player: {
        id: "player-2",
        publicName: "Royal Ghosted",
        playerTag: "#UL2V9QRGO",
        totalGames: 42,
        xp: 900,
        level: 4,
        levelStartGames: 25,
        nextLevelGames: 50,
      },
    });
    repository.getCrProfile.mockResolvedValue({
      tag: "#UL2V9QRGO",
      status: "ready",
      name: "King Thing",
      clan: {
        tag: "#J2RGCRVG",
        name: "POAP KINGS",
        badgeId: 16000000,
        role: "leader",
      },
      accountAge: { days: 2_000, years: 5 },
      cards: [{ id: 26000000, name: "Knight" }],
      fetchedAt: "2026-08-07T12:00:00.000Z",
      updatedAt: "2026-08-07T12:00:00.000Z",
    });

    const result = await handler(
      playerEvent("player-2"),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");

    expect(repository.getCrProfile).toHaveBeenCalledWith("#UL2V9QRGO");
    const body = JSON.parse(result.body ?? "{}");
    expect(body.player.clashRoyale).toEqual({
      tag: "#UL2V9QRGO",
      status: "ready",
      name: "King Thing",
      clan: {
        tag: "#J2RGCRVG",
        name: "POAP KINGS",
        badgeId: 16000000,
        role: "leader",
      },
    });
    expect(body.player.clashRoyale).not.toHaveProperty("accountAge");
    expect(body.player.clashRoyale).not.toHaveProperty("cards");
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

  it("migrates retired Trade times without losing unrelated badges", async () => {
    repository.getBadges.mockResolvedValue({
      version: 1,
      values: { "sharp-trade": 55.639, podium: 5 },
      runsAtRung: { "sharp-trade": [6, 6, 3, 1, 1, 1, 1, 0, 0] },
      aux: { modes: ["trade"], cards: [], dayStreak: 1, dayRuns: 1 },
      earned: {
        "sharp-trade": Array(10).fill("2026-08-02T17:25:31.817Z"),
        podium: Array(4).fill("2026-08-03T10:12:48.768Z"),
      },
      updatedAt: "2026-08-05T21:35:48.609Z",
    });
    repository.listAllRuns.mockResolvedValue([
      {
        runId: "old-trade",
        mode: "trade",
        score: 55_639,
        completedAt: "2026-07-23T02:10:32.373Z",
      },
      {
        runId: "current-trade",
        mode: "trade",
        score: 67_126,
        completedAt: "2026-07-25T16:02:56.616Z",
      },
    ]);

    const result = await handler(
      playerEvent("player-2"),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");

    const body = JSON.parse(result.body ?? "{}");
    expect(body.badges.backfilled).toBe(true);
    expect(body.badges.badges).toContainEqual(
      expect.objectContaining({
        slug: "sharp-trade",
        value: 67.126,
        rungIndex: 10,
      }),
    );
    expect(body.badges.badges).toContainEqual(
      expect.objectContaining({ slug: "podium", value: 5, rungIndex: 3 }),
    );
    expect(repository.saveBadges).toHaveBeenCalledWith(
      "private-sub",
      expect.objectContaining({ version: 4 }),
      expect.any(String),
      {
        version: 1,
        updatedAt: "2026-08-05T21:35:48.609Z",
      },
    );
  });
});
