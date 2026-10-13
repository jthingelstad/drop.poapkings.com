import type { HttpRequest } from "../src/http.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const repository = vi.hoisted(() => ({
  leaderboard: vi.fn(),
  allTimeLeaderboard: vi.fn(),
  clanAllTimeLeaderboard: vi.fn(),
  getProfile: vi.fn(),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
  useRateLimit: vi.fn(),
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    leaderboard = repository.leaderboard;
    allTimeLeaderboard = repository.allTimeLeaderboard;
    clanAllTimeLeaderboard = repository.clanAllTimeLeaderboard;
    getProfile = repository.getProfile;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
    useRateLimit = repository.useRateLimit;
  },
}));
import { dispatch } from "../src/app.js";
import { signToken } from "../src/signing.js";
const nowSeconds = Math.floor(Date.now() / 1000);
function leaderboardEvent(query: string, authenticated = false): HttpRequest {
  return {
    path: "/leaderboards",
    headers: authenticated
      ? {
          authorization: `Bearer ${signToken(
            {
              type: "session",
              sub: "clan-player-sub",
              iat: nowSeconds,
              exp: nowSeconds + 3600,
            },
            "test-session-secret",
          )}`,
        }
      : {},
    query: Object.fromEntries(new URLSearchParams(query)),
    method: "GET",
    sourceIp: "127.0.0.1",
    requestId: "request-lb",
  } as HttpRequest;
}
const sampleRows = [
  {
    rank: 1,
    score: 11000,
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
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.leaderboard.mockResolvedValue(sampleRows);
    repository.allTimeLeaderboard.mockResolvedValue(sampleRows);
    repository.clanAllTimeLeaderboard.mockResolvedValue(sampleRows);
    repository.getProfile.mockResolvedValue({
      sub: "clan-player-sub",
      playerId: "clan-player",
      email: "clan@example.com",
      playerTag: "#PLAYER",
      totalGames: 4,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    repository.getCrProfile.mockResolvedValue({
      tag: "#PLAYER",
      status: "ready",
      clan: { tag: "#CLAN", name: "POAP KINGS", badgeId: 16000000 },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
  });
  it("returns the all-time board when scope=all-time", async () => {
    const result = await dispatch(
      leaderboardEvent("mode=surge&scope=all-time"),
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
    const result = await dispatch(leaderboardEvent("mode=surge"));
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(repository.leaderboard).toHaveBeenCalledOnce();
    expect(repository.allTimeLeaderboard).not.toHaveBeenCalled();
    expect(body.scope).toBe("season");
    expect(typeof body.seasonId).toBe("number");
  });
  it("requires authentication for the clan board", async () => {
    const result = await dispatch(leaderboardEvent("mode=surge&scope=clan"));
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(401);
    expect(repository.clanAllTimeLeaderboard).not.toHaveBeenCalled();
  });
  it("returns current-clan all-time rows to the linked player", async () => {
    const result = await dispatch(
      leaderboardEvent("mode=surge&scope=clan", true),
    );
    if (!result || typeof result === "string") throw new Error("no result");
    const body = JSON.parse(result.body ?? "{}");
    expect(result.statusCode).toBe(200);
    expect(repository.getProfile).toHaveBeenCalledWith("clan-player-sub");
    expect(repository.getCrProfile).toHaveBeenCalledWith("#PLAYER");
    expect(repository.clanAllTimeLeaderboard).toHaveBeenCalledWith(
      "surge",
      "#CLAN",
    );
    expect(body).toMatchObject({
      scope: "clan",
      clan: { tag: "#CLAN", name: "POAP KINGS" },
      entries: sampleRows,
    });
    expect(body.seasonId).toBeUndefined();
  });
  it("guides a player without a tag instead of querying a clan", async () => {
    repository.getProfile.mockResolvedValue({
      sub: "clan-player-sub",
      playerId: "clan-player",
      email: "clan@example.com",
      totalGames: 4,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const result = await dispatch(
      leaderboardEvent("mode=surge&scope=clan", true),
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      error: { code: "player_tag_required" },
    });
    expect(repository.getCrProfile).not.toHaveBeenCalled();
    expect(repository.clanAllTimeLeaderboard).not.toHaveBeenCalled();
  });
  it("guides a linked player who is not currently in a clan", async () => {
    repository.getCrProfile.mockResolvedValue({
      tag: "#PLAYER",
      status: "ready",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const result = await dispatch(
      leaderboardEvent("mode=surge&scope=clan", true),
    );
    if (!result || typeof result === "string") throw new Error("no result");
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      error: { code: "clan_membership_required" },
    });
    expect(repository.clanAllTimeLeaderboard).not.toHaveBeenCalled();
  });
});
