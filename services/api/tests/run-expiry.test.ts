import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getRun: vi.fn(),
  getProfile: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  createRun: vi.fn(),
  useRateLimit: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getRun = repository.getRun;
    getProfile = repository.getProfile;
    getCardStats = repository.getCardStats;
    createRun = repository.createRun;
    useRateLimit = repository.useRateLimit;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);

function sessionToken(): string {
  return signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
}

function event(
  path: string,
  body: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "content-type": "application/json",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe("run expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
  });

  it("returns 410 run_expired (not 401) for a run completed after its window", async () => {
    // The token carries the grace window the handler now mints, so token
    // verification succeeds and the run-level expiry check is what answers.
    const runToken = signToken(
      {
        type: "run",
        runId: "run-late",
        owner: "player-sub",
        mode: "surge",
        iat: nowSeconds - 7_200,
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
      startedAt: new Date((nowSeconds - 7_200) * 1_000).toISOString(),
      expiresAt: nowSeconds - 3_600,
    });

    const response = (await handler(
      event("/runs/complete", { runToken, transcript: {} }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
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
          startedAt: new Date(nowSeconds * 1_000).toISOString(),
          expiresAt,
        }),
    );

    const response = (await handler(
      event("/runs/start", { mode: "trade" }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(201);
    const runExpirySeconds = Math.floor(
      new Date(body.expiresAt as string).getTime() / 1_000,
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
    repository.createRun.mockImplementation(
      (
        owner: string,
        mode: string,
        challenge: { cardIds: number[] },
        expiresAt: number,
      ) =>
        Promise.resolve({
          runId: "run-focus",
          owner,
          mode,
          challenge,
          state: "started",
          startedAt: new Date(nowSeconds * 1_000).toISOString(),
          expiresAt,
          ranked: false,
        }),
    );

    const response = (await handler(
      event("/runs/start", { mode: "practice" }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(201);
    // Practice is true practice: runs are born unranked and never write a
    // leaderboard entry (completeRun skips the GSI for ranked:false).
    expect(body.ranked).toBe(false);
    expect(body.challenge.cardIds).toHaveLength(15);
    expect(repository.getCardStats).not.toHaveBeenCalled();
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
          startedAt: new Date(nowSeconds * 1_000).toISOString(),
          expiresAt,
          ranked,
        }),
    );

    const response = (await handler(
      event("/runs/start", { mode: "survival" }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
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
