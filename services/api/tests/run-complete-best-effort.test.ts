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
  getCardStats: vi.fn(),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
  getProfile: vi.fn(),
  getBadges: vi.fn(),
  getRun: vi.fn(),
  putRefereeEvidence: vi.fn(),
  saveBadges: vi.fn(),
  saveCardStats: vi.fn(),
  updateAllTimeBest: vi.fn(),
  useRateLimit: vi.fn(),
}));
const publishDiscordEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    completeRun = repository.completeRun;
    getCardStats = repository.getCardStats;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
    getProfile = repository.getProfile;
    getBadges = repository.getBadges;
    getRun = repository.getRun;
    putRefereeEvidence = repository.putRefereeEvidence;
    saveBadges = repository.saveBadges;
    saveCardStats = repository.saveCardStats;
    updateAllTimeBest = repository.updateAllTimeBest;
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
  playerTag: "#2PYQ0",
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

function completionEvent(): APIGatewayProxyEventV2 {
  const session = signToken(
    {
      type: "session",
      sub: profile.sub,
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
  const runToken = signToken(
    {
      type: "run",
      runId: "run-1",
      owner: profile.sub,
      mode: "surge",
      iat: nowSeconds - 60,
      exp: nowSeconds + 1_800,
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
      requestId: "request-best-effort",
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
          atMs: 3_000 + index * 1_500,
        })),
      },
    }),
    isBase64Encoded: false,
  };
}

async function complete() {
  const response = (await handler(
    completionEvent(),
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body || "{}") as Record<string, unknown>,
  };
}

// A recorded run is the player's game. Everything after the completeRun
// transaction — learning stats, the all-time projection, referee evidence, the
// Discord card — is decoration, and none of it may take the game away.
describe("run completion side effects are best effort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.getCardStats.mockResolvedValue({});
    repository.saveCardStats.mockResolvedValue(undefined);
    repository.getCrProfile.mockResolvedValue(undefined);
    repository.putRefereeEvidence.mockResolvedValue(undefined);
    repository.updateAllTimeBest.mockResolvedValue({ improved: false });
    repository.getBadges.mockResolvedValue(undefined);
    repository.saveBadges.mockResolvedValue(undefined);
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-1",
      sk: "RUN",
      runId: "run-1",
      owner: profile.sub,
      mode: "surge",
      challenge: { mode: "surge", cardIds: cards.map((card) => card.id) },
      state: "started",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
    });
    repository.completeRun.mockResolvedValue({
      totalGames: 5,
      completedAt: "2026-07-18T12:01:00.000Z",
      profile: { ...profile, totalGames: 5, xp: 45 },
    });
  });

  it("records the run when the learning-stats write fails", async () => {
    repository.saveCardStats.mockRejectedValue(new Error("stats table down"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({ accepted: true, totalGames: 5 });
    expect(publishDiscordEvent).toHaveBeenCalledOnce();
  });

  it("records the run when the badge write fails", async () => {
    repository.saveBadges.mockRejectedValue(new Error("badge table down"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({ accepted: true, totalGames: 5 });
    // No rungs come back, but the game itself is untouched.
    expect(result.body.earnedBadges).toBeUndefined();
    expect(publishDiscordEvent).toHaveBeenCalledOnce();
  });

  it("records the run when the badge read fails", async () => {
    repository.getBadges.mockRejectedValue(new Error("throttled"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(repository.saveBadges).not.toHaveBeenCalled();
  });

  it("returns the rungs a run cleared so the summary can celebrate them", async () => {
    const result = await complete();

    expect(result.statusCode).toBe(201);
    const earned = result.body.earnedBadges as Array<{ slug: string }>;
    const slugs = earned.map((rung) => rung.slug);
    // A fast, clean 15-card sprint climbs several Clockbreaker rungs at once
    // and takes Full Cup, whose 6+ cost cards were all named first try.
    expect(slugs).toContain("clockbreaker");
    expect(slugs).toContain("full-cup");
    // But one run is one run: the volume and habit ladders open at 10 Surge
    // runs, a 3-day streak and 5 games in a day, so none of them move yet.
    expect(slugs).not.toContain("surge-runner");
    expect(slugs).not.toContain("daily-drop");
    expect(slugs).not.toContain("marathon");
    expect(repository.saveBadges).toHaveBeenCalledOnce();
  });

  it("records the run when the all-time projection fails", async () => {
    repository.updateAllTimeBest.mockRejectedValue(new Error("throttled"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    // The evidence write still happens: one failed follow-up must not skip the
    // next one.
    expect(repository.putRefereeEvidence).toHaveBeenCalledOnce();
  });

  it("records the run when the referee evidence write fails", async () => {
    repository.putRefereeEvidence.mockRejectedValue(new Error("no capacity"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(publishDiscordEvent).toHaveBeenCalledOnce();
  });

  it("still announces the game when the Clash Royale snapshot cannot be read", async () => {
    repository.getCrProfile.mockRejectedValue(new Error("cr snapshot gone"));

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(publishDiscordEvent).toHaveBeenCalledOnce();
    expect(publishDiscordEvent.mock.calls[0]?.[1]).toBeDefined();
  });

  it("attaches the cached Clash Royale identity to the announcement", async () => {
    repository.getCrProfile.mockResolvedValue({
      tag: profile.playerTag,
      status: "ready",
      name: "KingThing",
      updatedAt: "2026-07-18T00:00:00.000Z",
    });

    const result = await complete();

    expect(result.statusCode).toBe(201);
    expect(repository.getCrProfile).toHaveBeenCalledWith(profile.playerTag);
  });

  it("propagates a failed completeRun instead of pretending the game counted", async () => {
    const conflict = Object.assign(
      new Error("This run was already recorded or is no longer valid."),
      { statusCode: 409, code: "run_conflict" },
    );
    repository.completeRun.mockRejectedValue(conflict);

    const result = await complete();

    // Not an HttpError instance, so the handler reports a safe 500 — the point
    // is that nothing downstream ran and nothing was announced.
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect(repository.updateAllTimeBest).not.toHaveBeenCalled();
    expect(publishDiscordEvent).not.toHaveBeenCalled();
  });
});
