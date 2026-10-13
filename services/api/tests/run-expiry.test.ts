import type { HttpRequest, HttpResponse } from "../src/http.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "../src/signing.js";
const repository = vi.hoisted(() => ({
  getRun: vi.fn(),
  getProfile: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  createRun: vi.fn(),
  useRateLimit: vi.fn(),
  rankedAccess: vi.fn(async (): Promise<"allowed" | "restricted"> => "allowed"),
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getRun = repository.getRun;
    getProfile = repository.getProfile;
    getCardStats = repository.getCardStats;
    createRun = repository.createRun;
    useRateLimit = repository.useRateLimit;
    rankedAccess = repository.rankedAccess;
  },
}));
import rawCards from "@elixir-drop/game-data/cards.json";
import { dispatch } from "../src/app.js";
const CATALOG_SIZE = (
  rawCards as {
    cards: unknown[];
  }
).cards.length;
const secret = "test-session-secret";
const nowSeconds = Date.parse("2026-07-18T12:05:00Z") / 1000;
function sessionToken(): string {
  return signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3600,
    },
    secret,
  );
}
function event(path: string, body: Record<string, unknown>): HttpRequest {
  return {
    path,
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "content-type": "application/json",
    },
    method: "POST",
    sourceIp: "127.0.0.1",
    requestId: "request-1",
    body: JSON.stringify(body),
  } as HttpRequest;
}
describe("run expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowSeconds * 1000);
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.rankedAccess.mockReset().mockResolvedValue("allowed");
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("returns 410 run_expired (not 401) for a run completed after its window", async () => {
    // The token carries the grace window the dispatch now mints, so token
    // verification succeeds and the run-level expiry check is what answers.
    const runToken = signToken(
      {
        type: "run",
        runId: "run-late",
        owner: "player-sub",
        mode: "surge",
        iat: nowSeconds - 7200,
        exp: nowSeconds + 22 * 60 * 60,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-late",
      sk: "RUN",
      runId: "run-late",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [] },
      state: "started",
      startedAt: new Date((nowSeconds - 7200) * 1000).toISOString(),
      expiresAt: nowSeconds - 3600,
    });
    const response = (await dispatch(
      event("/runs/complete", { runToken, transcript: {} }),
    )) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(410);
    expect(body.error.code).toBe("run_expired");
  });
  it("mints run tokens that outlive the run window so 410 stays reachable", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      totalGames: 3,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    });
    repository.createRun.mockImplementation(
      (owner: string, mode: string, challenge: unknown, expiresAt: number) =>
        Promise.resolve({
          runId: "run-new",
          owner,
          mode,
          challenge,
          state: "started",
          startedAt: new Date(nowSeconds * 1000).toISOString(),
          expiresAt,
        }),
    );
    const response = (await dispatch(
      event("/runs/start", { mode: "trade" }),
    )) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(201);
    const runExpirySeconds = Math.floor(
      new Date(body.expiresAt as string).getTime() / 1000,
    );
    // Verify the token well after the run window: the claims must still parse
    // so completion reaches the explicit run-level 410 branch.
    const claims = verifyToken(
      body.runToken as string,
      "run",
      secret,
      runExpirySeconds + 60,
    );
    expect(claims.runId).toBe("run-new");
    expect(claims.exp).toBeGreaterThan(runExpirySeconds + 12 * 60 * 60);
  });
  it("starts Practice from the full catalog without consulting personalized data", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      playerTag: "#2PYQ0",
      totalGames: 12,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    });
    // Historical learning data remains stored, but challenge generation no
    // longer reads it or the linked Clash Royale collection.
    repository.getCardStats.mockResolvedValue({
      "26000000": {
        seen: 4,
        correct: 1,
        missStreak: 2,
        lastSeenAt: "2026-07-18T12:00:00.000Z",
      },
    });
    repository.rankedAccess.mockResolvedValue("restricted");
    repository.createRun.mockImplementation(
      (
        owner: string,
        mode: string,
        challenge: {
          cardIds: number[];
        },
        expiresAt: number,
      ) =>
        Promise.resolve({
          runId: "run-focus",
          owner,
          mode,
          challenge,
          state: "started",
          startedAt: new Date(nowSeconds * 1000).toISOString(),
          expiresAt,
          ranked: false,
        }),
    );
    const response = (await dispatch(
      event("/runs/start", { mode: "practice" }),
    )) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(201);
    // Practice is true practice: runs are born unranked and never write a
    // leaderboard entry (completeRun skips the GSI for ranked:false).
    expect(body.ranked).toBe(false);
    // Practice is endless, so it is dealt the WHOLE shuffled catalog as a pool
    // for the client to weight across — not a fixed 15-card round.
    expect(body.challenge.cardIds).toHaveLength(CATALOG_SIZE);
    expect(new Set(body.challenge.cardIds).size).toBe(CATALOG_SIZE);
    expect(Date.parse(body.expiresAt)).toBe((nowSeconds + 24 * 60 * 60) * 1000);
    expect(repository.getCardStats).not.toHaveBeenCalled();
    expect(repository.rankedAccess).not.toHaveBeenCalled();
    expect(repository.createRun).toHaveBeenCalledWith(
      "player-sub",
      "practice",
      expect.anything(),
      expect.any(Number),
      false,
      false,
      // The derived start-time correlation hashes ride along on every run.
      expect.any(Object),
    );
  });
  it("blocks a restricted player from starting a ranked run", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      totalGames: 12,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    });
    repository.rankedAccess.mockResolvedValue("restricted");
    const response = (await dispatch(
      event("/runs/start", { mode: "surge" }),
    )) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("ranked_access_restricted");
    expect(repository.createRun).not.toHaveBeenCalled();
  });
  it("starts every non-practice mode ranked", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      totalGames: 12,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    });
    repository.createRun.mockImplementation(
      (
        owner: string,
        mode: string,
        challenge: unknown,
        expiresAt: number,
        ranked: boolean,
      ) =>
        Promise.resolve({
          runId: "run-ranked",
          owner,
          mode,
          challenge,
          state: "started",
          startedAt: new Date(nowSeconds * 1000).toISOString(),
          expiresAt,
          ranked,
        }),
    );
    const response = (await dispatch(
      event("/runs/start", { mode: "survival" }),
    )) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(201);
    expect(body.ranked).toBe(true);
    expect(repository.createRun).toHaveBeenCalledWith(
      "player-sub",
      "survival",
      expect.anything(),
      expect.any(Number),
      true,
      false,
      expect.any(Object),
    );
  });
});
