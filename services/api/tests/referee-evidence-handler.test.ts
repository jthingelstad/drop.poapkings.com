import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  useRateLimit: vi.fn(),
  getProfile: vi.fn(),
  getRun: vi.fn(),
  getCrWarClock: vi.fn(),
  getCrProfile: vi.fn(),
  completeRun: vi.fn(),
  updateAllTimeBest: vi.fn(),
  saveCardStats: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  putRefereeEvidence: vi.fn(),
}));
const publishDiscordEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    useRateLimit = repository.useRateLimit;
    getProfile = repository.getProfile;
    getRun = repository.getRun;
    getCrWarClock = repository.getCrWarClock;
    getCrProfile = repository.getCrProfile;
    completeRun = repository.completeRun;
    updateAllTimeBest = repository.updateAllTimeBest;
    saveCardStats = repository.saveCardStats;
    getCardStats = repository.getCardStats;
    putRefereeEvidence = repository.putRefereeEvidence;
  },
}));

vi.mock("../src/discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/discord.js")>();
  return { ...actual, publishDiscordEvent };
});

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const cards = (
  rawCards as { cards: Array<{ id: number; elixir: number }> }
).cards.slice(0, 15);
const profile = {
  sub: "player-sub",
  playerId: "player-1",
  email: "player@example.com",
  publicName: "Knight Main",
  favoriteCardId: 26000000,
  playerTag: "#2PYQ0",
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

function signedInEvent(body: Record<string, unknown>): APIGatewayProxyEventV2 {
  const session = signToken(
    {
      type: "session",
      sub: profile.sub,
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/runs/complete",
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/runs/complete",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.7",
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

function guestEvent(body: Record<string, unknown>): APIGatewayProxyEventV2 {
  const event = signedInEvent(body);
  delete event.headers.authorization;
  return event;
}

function surgeTranscript(stepMs: number) {
  return {
    answers: cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: 1_000 + index * stepMs,
    })),
  };
}

describe("referee evidence write path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.getCrProfile.mockResolvedValue(undefined);
    repository.updateAllTimeBest.mockResolvedValue(undefined);
    repository.putRefereeEvidence.mockResolvedValue(undefined);
  });

  it("writes ranked evidence for an accepted ranked completion", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-accepted",
        owner: profile.sub,
        mode: "surge",
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-accepted",
      sk: "RUN",
      runId: "run-accepted",
      owner: profile.sub,
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((c) => c.id) },
      state: "started",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
      startCorrelation: { ipHash: "starthash", uaFamily: "Chrome/macOS" },
    });
    repository.completeRun.mockResolvedValue({
      totalGames: 5,
      completedAt: "2026-07-18T12:01:00.000Z",
      profile: { ...profile, totalGames: 5 },
    });

    // atMs step of 350 => last atMs ~5900, comfortably above the surge floor.
    const response = (await handler(
      signedInEvent({ runToken, transcript: surgeTranscript(350) }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(201);
    expect(repository.putRefereeEvidence).toHaveBeenCalledTimes(1);
    const item = repository.putRefereeEvidence.mock.calls[0]?.[0];
    expect(item).toMatchObject({
      pk: "PLAYER#player-sub",
      runId: "run-accepted",
      runType: "ranked",
      integrityOutcome: "accepted",
      playerTag: "#2PYQ0",
      schemaVersion: "1",
    });
    expect(item.sk).toBe("EVIDENCE#2026-07-18T12:01:00.000Z#run-accepted");
    expect(item.transcript.answers).toHaveLength(15);
    expect(item.correlation.start).toEqual({
      ipHash: "starthash",
      uaFamily: "Chrome/macOS",
    });
    expect(item.correlation.complete.ipHash).toBeDefined();
    // No raw IP / user-agent / email anywhere in the stored evidence.
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("203.0.113.7");
    expect(serialized).not.toContain("Mozilla");
    expect(serialized).not.toContain("player@example.com");
  });

  it("writes NO evidence for a guest completion", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-guest",
        owner: "guest",
        mode: "surge",
        guest: true,
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-guest",
      sk: "RUN",
      runId: "run-guest",
      owner: "guest",
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((c) => c.id) },
      state: "started",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
      guest: true,
    });

    const response = (await handler(
      guestEvent({ runToken, transcript: surgeTranscript(350) }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(200);
    expect(repository.putRefereeEvidence).not.toHaveBeenCalled();
  });

  it("writes ranked evidence for an automatically quarantined completion", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-rejected",
        owner: profile.sub,
        mode: "surge",
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-rejected",
      sk: "RUN",
      runId: "run-rejected",
      owner: profile.sub,
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((c) => c.id) },
      state: "started",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
    });
    repository.completeRun.mockResolvedValue({
      totalGames: 5,
      completedAt: "2026-07-18T12:01:00.000Z",
      profile: { ...profile, totalGames: 5 },
    });

    // A low atMs step keeps the score under the surge UI floor -> hidden review.
    const response = (await handler(
      signedInEvent({ runToken, transcript: surgeTranscript(100) }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({ accepted: true, underReview: true });
    expect(repository.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-rejected" }),
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
      undefined,
      "score_below_ui_floor",
    );
    expect(repository.putRefereeEvidence).toHaveBeenCalledTimes(1);
    const item = repository.putRefereeEvidence.mock.calls[0]?.[0];
    expect(item).toMatchObject({
      runId: "run-rejected",
      runType: "ranked",
      integrityOutcome: "score_below_ui_floor",
    });
    expect(publishDiscordEvent).not.toHaveBeenCalled();
  });

  it("writes rejected evidence (with the reason, no score) for a scorer-rejected completion", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-scorer-reject",
        owner: profile.sub,
        mode: "surge",
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-scorer-reject",
      sk: "RUN",
      runId: "run-scorer-reject",
      owner: profile.sub,
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((c) => c.id) },
      state: "started",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
    });

    // An incomplete transcript (no answers) trips the scorer before a score exists.
    const response = (await handler(
      signedInEvent({ runToken, transcript: { answers: [] } }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(400);
    expect(repository.putRefereeEvidence).toHaveBeenCalledTimes(1);
    const item = repository.putRefereeEvidence.mock.calls[0]?.[0];
    expect(item.runType).toBe("rejected");
    expect(item.score).toBeUndefined();
    expect(typeof item.integrityOutcome).toBe("string");
    expect(item.transcript).toEqual({ answers: [] });
  });
});
