import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import { signToken } from "../src/signing.js";

// Practice completions end to end: endless, unranked, XP-free. The drill is
// deliberately outside every competitive and progression surface, and this suite
// is what holds it there.
const repository = vi.hoisted(() => ({
  completeRun: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  getLedgerStats: vi.fn(async () => undefined),
  getCrWarClock: vi.fn(),
  getBadges: vi.fn(),
  getProfile: vi.fn(),
  getRun: vi.fn(),
  putRefereeEvidence: vi.fn(),
  saveBadges: vi.fn(),
  saveCardStats: vi.fn(),
  saveLedgerStats: vi.fn(),
  updateAllTimeBest: vi.fn(),
  wouldLeadAllTime: vi.fn(async () => false),
  wouldLeadSeason: vi.fn(async () => false),
  useRateLimit: vi.fn(),
}));
const publishDiscordEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    completeRun = repository.completeRun;
    getCardStats = repository.getCardStats;
    getLedgerStats = repository.getLedgerStats;
    getCrWarClock = repository.getCrWarClock;
    getBadges = repository.getBadges;
    getProfile = repository.getProfile;
    getRun = repository.getRun;
    putRefereeEvidence = repository.putRefereeEvidence;
    saveBadges = repository.saveBadges;
    saveCardStats = repository.saveCardStats;
    saveLedgerStats = repository.saveLedgerStats;
    updateAllTimeBest = repository.updateAllTimeBest;
    wouldLeadAllTime = repository.wouldLeadAllTime;
    wouldLeadSeason = repository.wouldLeadSeason;
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
const allCards = (rawCards as { cards: Array<{ id: number; elixir: number }> })
  .cards;
// The signed Practice deck is the whole shuffled catalog (a pool, not a round).
const deck = allCards.map((card) => card.id);
const profile = {
  sub: "player-sub",
  playerId: "player-1",
  email: "player@example.com",
  publicName: "Knight Main",
  favoriteCardId: 26000000,
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
};

function completionEvent(
  runToken: string,
  answers: Array<Record<string, unknown>>,
): APIGatewayProxyEventV2 {
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
      time: "24/Jul/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify({ runToken, transcript: { answers } }),
    isBase64Encoded: false,
  };
}

function practiceRunToken(): string {
  return signToken(
    {
      type: "run",
      runId: "run-practice",
      owner: profile.sub,
      mode: "practice",
      iat: nowSeconds - 60,
      exp: nowSeconds + 1_800,
    },
    secret,
  );
}

async function completePractice(
  answers: Array<{
    cardId: number;
    guess: number;
    responseMs?: number;
    assisted?: boolean;
  }>,
) {
  repository.getRun.mockResolvedValue({
    pk: "RUN#run-practice",
    sk: "RUN",
    runId: "run-practice",
    owner: profile.sub,
    mode: "practice",
    challenge: { mode: "practice", cardIds: deck },
    state: "started",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: nowSeconds + 1_800,
    ranked: false,
  });
  repository.completeRun.mockResolvedValue({
    totalGames: 5,
    completedAt: "2026-07-24T12:01:00.000Z",
    profile: { ...profile, totalGames: 5, xp: 45 },
  });
  const response = (await handler(
    completionEvent(practiceRunToken(), answers),
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
  return { response, body: JSON.parse(response.body || "{}") };
}

describe("Practice completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrWarClock.mockResolvedValue(undefined);
    repository.getBadges.mockImplementation(
      async () => repository.saveBadges.mock.calls.at(-1)?.[1],
    );
    repository.putRefereeEvidence.mockResolvedValue(undefined);
    repository.saveBadges.mockResolvedValue(true);
    repository.saveCardStats.mockResolvedValue(undefined);
    repository.saveLedgerStats.mockResolvedValue(undefined);
    repository.updateAllTimeBest.mockResolvedValue(undefined);
    repository.useRateLimit.mockResolvedValue(undefined);
  });

  it("earns ZERO Player XP", async () => {
    // 40 questions — under the old rules that was 40 XP, and an endless session
    // could mint arena tiers forever.
    const answers = Array.from({ length: 40 }, (_, index) => {
      const card = allCards[index % allCards.length]!;
      return { cardId: card.id, guess: card.elixir };
    });
    const { response } = await completePractice(answers);

    expect(response.statusCode).toBe(201);
    expect(repository.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-practice" }),
      100,
      expect.any(String),
      0, // xpAward
      undefined,
      undefined,
    );
  });

  it("accepts a transcript of any length, in any order, and still records the run", async () => {
    const first = allCards[0]!;
    const later = allCards[70]!;
    const { response, body } = await completePractice([
      { cardId: later.id, guess: later.elixir },
      { cardId: first.id, guess: first.elixir === 1 ? 2 : 1 },
      { cardId: later.id, guess: later.elixir },
    ]);

    expect(response.statusCode).toBe(201);
    // Accuracy is a session stat, not a score: 2 of 3. Practice earns no XP, so
    // the per-run award is zero.
    expect(body).toMatchObject({
      accepted: true,
      score: 67,
      ranked: false,
      xpEarned: 0,
    });
    // The run still completes server-side — that is what feeds the server-owned
    // learning stats.
    expect(repository.saveCardStats).toHaveBeenCalled();
  });

  it("stores recall speed separately from assisted recognition", async () => {
    const recalled = allCards[0]!;
    const assisted = allCards[1]!;
    const { response } = await completePractice([
      {
        cardId: recalled.id,
        guess: recalled.elixir,
        responseMs: 900,
        assisted: false,
      },
      {
        cardId: assisted.id,
        guess: assisted.elixir,
        responseMs: 8_000,
        assisted: true,
      },
    ]);

    expect(response.statusCode).toBe(201);
    const saved = repository.saveCardStats.mock.calls.at(-1)?.[1];
    expect(saved[String(recalled.id)]).toMatchObject({
      recallSeen: 1,
      recallCorrect: 1,
      avgMs: 900,
      latencySamples: 1,
    });
    expect(saved[String(assisted.id)]).toMatchObject({
      recallSeen: 0,
      recallCorrect: 0,
      assistedSeen: 1,
      assistedCorrect: 1,
    });
    expect(saved[String(assisted.id)].avgMs).toBeUndefined();
  });

  it("accumulates Reps across sessions and returns the current ladder", async () => {
    const answers = (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const card = allCards[index % allCards.length]!;
        return { cardId: card.id, guess: card.elixir };
      });

    const first = await completePractice(answers(40));
    const second = await completePractice(answers(75));
    const reps = (result: typeof first) =>
      result.body.badges.badges.find(
        (badge: { slug: string }) => badge.slug === "reps",
      );

    expect(reps(first)).toMatchObject({ value: 40, rungIndex: -1 });
    expect(reps(second)).toMatchObject({ value: 115, rungIndex: 0 });
    expect(repository.saveBadges).toHaveBeenCalledTimes(2);
  });

  it("requires exact first-read accuracy for Clean Sweep, not a rounded 100% score", async () => {
    const answers = Array.from({ length: 200 }, (_, index) => {
      const card = allCards[index % allCards.length]!;
      return { cardId: card.id, guess: card.elixir };
    });
    const missed = answers[0]!;
    const rounded = await completePractice([
      {
        ...missed,
        guess: missed.guess === 1 ? 2 : 1,
      },
      ...answers.slice(1),
    ]);
    const cleanSweep = (result: typeof rounded) =>
      result.body.badges.badges.find(
        (badge: { slug: string }) => badge.slug === "clean-sweep",
      );

    // 199 / 200 rounds to 100 for the session display, but it is not perfect.
    expect(rounded.body.score).toBe(100);
    expect(cleanSweep(rounded)).toMatchObject({ rungIndex: -1 });

    const perfect = await completePractice(answers.slice(0, 20));
    expect(cleanSweep(perfect)).toMatchObject({ value: 1, rungIndex: 0 });
  });

  it("never writes a leaderboard best or referee evidence", async () => {
    const card = allCards[3]!;
    await completePractice([{ cardId: card.id, guess: card.elixir }]);

    // Both are gated on `ranked !== false`, which Practice never is.
    expect(repository.updateAllTimeBest).not.toHaveBeenCalled();
    expect(repository.putRefereeEvidence).not.toHaveBeenCalled();
  });

  it("stores Ledger progress separately without adding Cost Recall Reps", async () => {
    const blue = allCards.find((card) => card.elixir === 3)!;
    const red = allCards.find((card) => card.elixir === 5)!;
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-practice",
      sk: "RUN",
      runId: "run-practice",
      owner: profile.sub,
      mode: "practice",
      challenge: {
        mode: "practice",
        practiceKind: "ledger",
        cardIds: deck,
      },
      state: "started",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
      ranked: false,
    });
    repository.completeRun.mockResolvedValue({
      totalGames: 5,
      completedAt: "2026-07-24T12:01:00.000Z",
      profile: { ...profile, totalGames: 5, xp: 45 },
    });
    const response = (await handler(
      completionEvent(practiceRunToken(), [
        {
          plays: [
            { side: "blue", cardId: blue.id },
            { side: "red", cardId: red.id },
          ],
          guess: 2,
          responseMs: 1_200,
          assisted: false,
          stage: "guided",
        },
      ]),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(201);
    expect(repository.saveLedgerStats).toHaveBeenCalledWith(
      profile.sub,
      expect.objectContaining({
        checks: 1,
        correct: 1,
        unassistedChecks: 1,
        longestSequence: 2,
      }),
      "2026-07-24T12:01:00.000Z",
    );
    expect(repository.saveCardStats).not.toHaveBeenCalled();
    expect(repository.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ answerCount: 0 }),
      100,
      expect.any(String),
      0,
      undefined,
      undefined,
    );
    const savedBadges = repository.saveBadges.mock.calls.at(-1)?.[1];
    expect(savedBadges.values.reps).toBeUndefined();
    expect(savedBadges.values["clean-sweep"]).toBeUndefined();
  });

  // Practice is a private drill. An endless session has no comparable number to
  // broadcast — one correct answer then quitting scores 100% — so it must never
  // reach the clan feed.
  it("never posts to the clan Discord feed", async () => {
    const card = allCards[7]!;
    await completePractice([{ cardId: card.id, guess: card.elixir }]);

    expect(publishDiscordEvent).not.toHaveBeenCalled();
  });

  it("rejects an answer for a card outside the signed deck", async () => {
    const outsider = allCards[5]!;
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-practice",
      sk: "RUN",
      runId: "run-practice",
      owner: profile.sub,
      mode: "practice",
      // A deck the outsider card is deliberately not part of.
      challenge: {
        mode: "practice",
        cardIds: deck.filter((id) => id !== outsider.id).slice(0, 20),
      },
      state: "started",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
      ranked: false,
    });

    const response = (await handler(
      completionEvent(practiceRunToken(), [
        { cardId: outsider.id, guess: outsider.elixir },
      ]),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(400);
    expect(repository.completeRun).not.toHaveBeenCalled();
  });

  it("rejects invalid response timing and assistance metadata", async () => {
    const card = allCards[0]!;
    const badTime = await completePractice([
      { cardId: card.id, guess: card.elixir, responseMs: 60_001 },
    ]);
    expect(badTime.response.statusCode).toBe(400);

    const badAssistance = await completePractice([
      {
        cardId: card.id,
        guess: card.elixir,
        assisted: "yes" as unknown as boolean,
      },
    ]);
    expect(badAssistance.response.statusCode).toBe(400);
    expect(repository.completeRun).not.toHaveBeenCalled();
  });
});
