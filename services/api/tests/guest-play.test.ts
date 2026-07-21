import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import { signToken, verifyToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  useRateLimit: vi.fn(),
  getProfile: vi.fn(),
  createRun: vi.fn(),
  getRun: vi.fn(),
  getCrWarClock: vi.fn(),
  completeRun: vi.fn(),
  updateAllTimeBest: vi.fn(),
  saveCardStats: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
}));
const publishDiscordEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    useRateLimit = repository.useRateLimit;
    getProfile = repository.getProfile;
    createRun = repository.createRun;
    getRun = repository.getRun;
    getCrWarClock = repository.getCrWarClock;
    completeRun = repository.completeRun;
    updateAllTimeBest = repository.updateAllTimeBest;
    saveCardStats = repository.saveCardStats;
    getCardStats = repository.getCardStats;
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

// A signed-OUT event carries no authorization header — that is what makes it a
// guest request.
function guestEvent(
  path: string,
  body: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
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

describe("guest play", () => {
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
  });

  it("starts a guest run without auth: a real challenge + a guest run token", async () => {
    repository.createRun.mockImplementation(
      (
        owner: string,
        mode: string,
        challenge: unknown,
        expiresAt: number,
        ranked: boolean,
        guest: boolean,
      ) =>
        Promise.resolve({
          pk: "RUN#run-guest",
          sk: "RUN",
          runId: "run-guest",
          owner,
          mode,
          challenge,
          state: "started",
          startedAt: new Date(nowSeconds * 1_000).toISOString(),
          expiresAt,
          ranked,
          guest,
        }),
    );

    const response = (await handler(
      guestEvent("/runs/start", { mode: "surge" }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(201);
    // A server-signed challenge is still dealt so scoring stays consistent.
    expect(body.challenge.cardIds).toHaveLength(15);
    expect(body.guest).toBe(true);
    // Guest runs are never ranked.
    expect(body.ranked).toBe(false);

    // Rate limiting runs first — even for a signed-out caller.
    expect(repository.useRateLimit).toHaveBeenCalledWith(
      "run-start",
      expect.any(String),
      300,
      60 * 60,
    );
    // No profile is required (and none is consulted) for a guest.
    expect(repository.getProfile).not.toHaveBeenCalled();
    // The run is created with the "guest" sentinel owner, unranked, guest=true.
    expect(repository.createRun).toHaveBeenCalledWith(
      "guest",
      "surge",
      expect.anything(),
      expect.any(Number),
      false,
      true,
      // The derived start-time correlation hashes ride along on every run.
      expect.any(Object),
    );

    // The signed run token itself is marked as a guest run owned by "guest".
    const claims = verifyToken(body.runToken as string, "run", secret);
    expect(claims.owner).toBe("guest");
    expect(claims.guest).toBe(true);
  });

  it("completes a guest run: returns the scored result and records NOTHING", async () => {
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
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
      guest: true,
    });

    const response = (await handler(
      guestEvent("/runs/complete", {
        runToken,
        transcript: {
          answers: cards.map((card, index) => ({
            cardId: card.id,
            guesses: [card.elixir],
            atMs: 1_000 + index * 100,
          })),
        },
      }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      guest: true,
      mode: "surge",
      score: expect.any(Number),
      season: { id: expect.any(String) },
    });
    // A guest completion returns no recorded fields.
    expect(body.runId).toBeUndefined();
    expect(body.totalGames).toBeUndefined();
    expect(body.xp).toBeUndefined();

    // Nothing is recorded: no completion, no XP/history, no all-time best, no
    // learning stats, no Discord, no profile read/write.
    expect(repository.completeRun).not.toHaveBeenCalled();
    expect(repository.updateAllTimeBest).not.toHaveBeenCalled();
    expect(repository.saveCardStats).not.toHaveBeenCalled();
    expect(repository.getProfile).not.toHaveBeenCalled();
    expect(publishDiscordEvent).not.toHaveBeenCalled();
  });
});
