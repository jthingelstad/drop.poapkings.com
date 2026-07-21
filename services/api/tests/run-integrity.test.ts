import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  completeRun: vi.fn(),
  getCrWarClock: vi.fn(),
  getProfile: vi.fn(),
  getRun: vi.fn(),
  useRateLimit: vi.fn(),
}));
const publishDiscordEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    completeRun = repository.completeRun;
    getCrWarClock = repository.getCrWarClock;
    getProfile = repository.getProfile;
    getRun = repository.getRun;
    useRateLimit = repository.useRateLimit;
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
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

function completionEvent(runToken: string): APIGatewayProxyEventV2 {
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
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify({
      runToken,
      transcript: {
        answers: cards.map((card, index) => ({
          cardId: card.id,
          guesses: [card.elixir],
          atMs: 1_000 + index * 100,
        })),
      },
    }),
    isBase64Encoded: false,
  };
}

describe("run integrity rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.useRateLimit.mockResolvedValue(undefined);
  });

  it("rejects an implausibly fast run and records nothing", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-fast",
        owner: profile.sub,
        mode: "surge",
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-fast",
      sk: "RUN",
      runId: "run-fast",
      owner: profile.sub,
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((card) => card.id) },
      state: "started",
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
    });

    const response = (await handler(
      completionEvent(runToken),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    // The run is rejected outright — not recorded, not credited, and the run
    // row is left "started" to TTL-expire on its own.
    expect(response.statusCode).toBe(400);
    expect(body.error?.code).toBe("integrity_rejected");
    expect(repository.completeRun).not.toHaveBeenCalled();
    expect(repository.getProfile).not.toHaveBeenCalled();
    expect(publishDiscordEvent).not.toHaveBeenCalled();
  });
});
