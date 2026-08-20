import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listRecentRuns: vi.fn(),
  listRunHistory: vi.fn(),
  getCardStats: vi.fn(),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
  refereeDecisions: vi.fn(async () => new Map()),
  leaderboard: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  rankedAccess: vi.fn(async () => "allowed" as const),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getProfile = repository.getProfile;
    listRecentRuns = repository.listRecentRuns;
    listRunHistory = repository.listRunHistory;
    getCardStats = repository.getCardStats;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
    refereeDecisions = repository.refereeDecisions;
    leaderboard = repository.leaderboard;
    rankedAccess = repository.rankedAccess;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const sub = "player-sub";

function meEvent(
  path = "/me",
  queryStringParameters?: Record<string, string>,
): APIGatewayProxyEventV2 {
  const session = signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3_600 },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: new URLSearchParams(queryStringParameters ?? {}).toString(),
    ...(queryStringParameters ? { queryStringParameters } : {}),
    headers: { authorization: `Bearer ${session}` },
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
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
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

  it("shows review state only to the run owner", async () => {
    repository.listRecentRuns.mockResolvedValue([
      {
        runId: "pending-run",
        mode: "surge",
        score: 9_000,
        seasonId: "2026-08",
        completedAt: "2026-08-12T17:00:00.000Z",
      },
      {
        runId: "reviewed-run",
        mode: "trade",
        score: 50_000,
        seasonId: "2026-08",
        completedAt: "2026-08-12T16:00:00.000Z",
      },
      {
        runId: "reopened-run",
        mode: "surge",
        score: 10_230,
        seasonId: "2026-08",
        completedAt: "2026-08-12T15:30:00.000Z",
      },
      {
        runId: "excluded-run",
        mode: "survival",
        score: 80,
        seasonId: "2026-08",
        completedAt: "2026-08-12T15:00:00.000Z",
      },
    ]);
    repository.refereeDecisions.mockResolvedValueOnce(
      new Map([
        [
          "pending-run",
          {
            runId: "pending-run",
            decidedBy: "integrity-gate",
            visibility: "hidden",
            reason: "private automatic reason",
          },
        ],
        [
          "reviewed-run",
          {
            runId: "reviewed-run",
            decidedBy: "fair-play-referee",
            visibility: "visible",
            disposition: "clear",
            reason: "private referee reason",
          },
        ],
        [
          "reopened-run",
          {
            runId: "reopened-run",
            decidedBy: "fair-play-referee",
            visibility: "hidden",
            disposition: "review",
            queueState: "pending",
            reason: "private player-pattern re-review reason",
          },
        ],
        [
          "excluded-run",
          {
            runId: "excluded-run",
            decidedBy: "fair-play-referee",
            visibility: "hidden",
            disposition: "review",
            reason: "private referee reason",
            playerExplanationCode: "response_timing",
          },
        ],
      ]),
    );

    const result = await handler(meEvent(), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");
    const body = JSON.parse(result.body ?? "{}");

    expect(body.recentRuns).toMatchObject([
      { runId: "pending-run", reviewStatus: "pending" },
      { runId: "reviewed-run", reviewStatus: "reviewed" },
      { runId: "reopened-run", reviewStatus: "pending" },
      {
        runId: "excluded-run",
        reviewStatus: "excluded",
        reviewExplanation:
          "This run was excluded because its recorded response timing was not consistent with human play.",
      },
    ]);
    expect(JSON.stringify(body.recentRuns)).not.toContain("private");
  });
});

describe("GET /me/seasons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
  });

  it("indexes every season but ships only the most recent one by default", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "new-1",
        mode: "trade",
        score: 91_000,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
      {
        runId: "old-1",
        mode: "surge",
        score: 22_000,
        seasonId: "2026-07",
        completedAt: "2026-07-20T18:00:00.000Z",
      },
      {
        runId: "old-2",
        mode: "practice",
        score: 0,
        seasonId: "2026-07",
        completedAt: "2026-07-19T18:00:00.000Z",
      },
      {
        runId: "retired",
        mode: "identify",
        score: 8,
        seasonId: "2025-10",
        completedAt: "2025-10-01T00:00:00.000Z",
      },
    ]);

    const result = await handler(meEvent("/me/seasons"), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");

    expect(result.statusCode).toBe(200);
    expect(repository.listRunHistory).toHaveBeenCalledWith(sub);
    const body = JSON.parse(result.body ?? "{}");
    // The index covers the career — a row per season, no runs — while the
    // payload carries one season. Retired modes are dropped from both.
    expect(body.index).toEqual([
      { id: "2026-08", games: 1 },
      { id: "2026-07", games: 2 },
    ]);
    expect(body.seasons).toEqual([
      {
        id: "2026-08",
        games: 1,
        runs: [expect.objectContaining({ runId: "new-1", mode: "trade" })],
      },
    ]);
  });

  it("numbers each indexed season the way players read it", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "a",
        mode: "surge",
        score: 1,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
      {
        runId: "b",
        mode: "surge",
        score: 2,
        seasonId: "2026-06",
        completedAt: "2026-06-02T18:00:00.000Z",
      },
      {
        runId: "c",
        mode: "surge",
        score: 3,
        seasonId: "2026-05-131",
        completedAt: "2026-05-20T18:00:00.000Z",
      },
    ]);
    repository.getCrWarClock.mockResolvedValue({
      leaderboardSeasonId: "2026-08",
      crSeasonId: 135,
    });

    const result = await handler(meEvent("/me/seasons"), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");
    // Sequential monthly seasons count back from the live clock; an id that
    // states its own number is trusted over the arithmetic.
    expect(JSON.parse(result.body ?? "{}").index).toEqual([
      { id: "2026-08", games: 1, crSeasonId: 135 },
      { id: "2026-06", games: 1, crSeasonId: 133 },
      { id: "2026-05-131", games: 1, crSeasonId: 131 },
    ]);
  });

  it("omits the season number when no clock can anchor it", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "a",
        mode: "surge",
        score: 1,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
    ]);
    repository.getCrWarClock.mockResolvedValue(undefined);

    const result = await handler(meEvent("/me/seasons"), {} as never, () => {});
    if (!result || typeof result === "string") throw new Error("no result");
    expect(JSON.parse(result.body ?? "{}").index).toEqual([
      { id: "2026-08", games: 1 },
    ]);
  });

  it("places only the run holding the player's board position, on request", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "best",
        mode: "surge",
        score: 12_000,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
      {
        runId: "worse",
        mode: "surge",
        score: 19_000,
        seasonId: "2026-08",
        completedAt: "2026-08-01T18:00:00.000Z",
      },
    ]);
    repository.leaderboard.mockResolvedValue([
      {
        rank: 4,
        achievedAt: "2026-08-02T18:00:00.000Z",
        player: { id: "player-1" },
      },
    ]);

    const result = await handler(
      meEvent("/me/seasons", { placements: "1" }),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");
    const runs = JSON.parse(result.body ?? "{}").seasons[0].runs;
    expect(runs).toEqual([
      expect.objectContaining({ runId: "best", placement: 4 }),
      expect.objectContaining({ runId: "worse" }),
    ]);
    expect(runs[1].placement).toBeUndefined();
  });

  it("keeps the history readable when a board read fails", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "best",
        mode: "surge",
        score: 12_000,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
    ]);
    repository.leaderboard.mockRejectedValue(new Error("board unavailable"));

    const result = await handler(
      meEvent("/me/seasons", { placements: "1" }),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(200);
    expect(
      JSON.parse(result.body ?? "{}").seasons[0].runs[0].placement,
    ).toBeUndefined();
  });

  it("ships every season only when the caller asks for all of them", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "new-1",
        mode: "trade",
        score: 91_000,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
      {
        runId: "old-1",
        mode: "surge",
        score: 22_000,
        seasonId: "2026-07",
        completedAt: "2026-07-20T18:00:00.000Z",
      },
    ]);

    const result = await handler(
      meEvent("/me/seasons", { season: "all" }),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(
      JSON.parse(result.body ?? "{}").seasons.map(
        (season: { id: string }) => season.id,
      ),
    ).toEqual(["2026-08", "2026-07"]);
  });

  it("narrows the history by season and mode", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "new-1",
        mode: "trade",
        score: 91_000,
        seasonId: "2026-08",
        completedAt: "2026-08-02T18:00:00.000Z",
      },
      {
        runId: "old-1",
        mode: "surge",
        score: 22_000,
        seasonId: "2026-07",
        completedAt: "2026-07-20T18:00:00.000Z",
      },
      {
        runId: "old-2",
        mode: "practice",
        score: 0,
        seasonId: "2026-07",
        completedAt: "2026-07-19T18:00:00.000Z",
      },
    ]);

    const result = await handler(
      meEvent("/me/seasons", { season: "2026-07", mode: "surge" }),
      {} as never,
      () => {},
    );
    if (!result || typeof result === "string") throw new Error("no result");

    expect(result.statusCode).toBe(200);
    const narrowed = JSON.parse(result.body ?? "{}");
    expect(narrowed.index).toEqual([
      { id: "2026-08", games: 1 },
      { id: "2026-07", games: 2 },
    ]);
    expect(narrowed.seasons).toEqual([
      {
        id: "2026-07",
        games: 1,
        runs: [expect.objectContaining({ runId: "old-1" })],
      },
    ]);
  });

  it("narrows by review status, counting an untouched run as reviewed", async () => {
    repository.listRunHistory.mockResolvedValue([
      {
        runId: "held",
        mode: "surge",
        score: 20_000,
        seasonId: "2026-07",
        completedAt: "2026-07-20T18:00:00.000Z",
      },
      {
        runId: "untouched",
        mode: "surge",
        score: 22_000,
        seasonId: "2026-07",
        completedAt: "2026-07-19T18:00:00.000Z",
      },
    ]);
    repository.refereeDecisions.mockResolvedValue(
      new Map([
        [
          "held",
          {
            runId: "held",
            visibility: "hidden",
            decidedBy: "integrity-gate",
          },
        ],
      ]) as never,
    );

    const held = await handler(
      meEvent("/me/seasons", { status: "pending" }),
      {} as never,
      () => {},
    );
    if (!held || typeof held === "string") throw new Error("no result");
    expect(JSON.parse(held.body ?? "{}").seasons[0].runs).toEqual([
      expect.objectContaining({ runId: "held", reviewStatus: "pending" }),
    ]);

    // A run no referee touched is NOT cleared — it has no status at all, and
    // only the dedicated `unreviewed` filter matches it.
    const cleared = await handler(
      meEvent("/me/seasons", { status: "reviewed" }),
      {} as never,
      () => {},
    );
    if (!cleared || typeof cleared === "string") throw new Error("no result");
    expect(JSON.parse(cleared.body ?? "{}").seasons).toEqual([]);

    const unreviewed = await handler(
      meEvent("/me/seasons", { status: "unreviewed" }),
      {} as never,
      () => {},
    );
    if (!unreviewed || typeof unreviewed === "string")
      throw new Error("no result");
    const unreviewedRuns = JSON.parse(unreviewed.body ?? "{}").seasons[0].runs;
    expect(unreviewedRuns).toEqual([
      expect.objectContaining({ runId: "untouched" }),
    ]);
    expect(unreviewedRuns[0].reviewStatus).toBeUndefined();
  });

  it("rejects an invalid season, mode, or status", async () => {
    repository.listRunHistory.mockResolvedValue([]);
    const queries: Array<Record<string, string>> = [
      { season: "nope" },
      { mode: "chess" },
      { status: "cleared" },
      { season: "2026-13-nope" },
    ];
    for (const query of queries) {
      const result = await handler(
        meEvent("/me/seasons", query),
        {} as never,
        () => {},
      );
      if (!result || typeof result === "string") throw new Error("no result");
      expect(result.statusCode).toBe(400);
    }
  });
});
