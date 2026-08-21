import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send }) },
  };
});

import { Repository, type RunItem } from "../src/repository.js";

function transactionCanceled(): Error {
  const error = new Error("transaction canceled");
  error.name = "TransactionCanceledException";
  return error;
}

describe("XP repository writes", () => {
  beforeEach(() => send.mockReset());

  it("atomically marks, increments, and attaches an exact-once run bonus", async () => {
    send.mockResolvedValueOnce({});
    const repository = new Repository("test-table");
    const award = {
      source: "daily-featured" as const,
      label: "Daily featured game",
      amount: 5,
    };

    await expect(
      repository.grantXpOnce(
        "player-a",
        "FEATURED#2026-08-21",
        award,
        "2026-08-21T12:00:00.000Z",
        {
          runId: "run-1",
          completedAt: "2026-08-21T12:00:00.000Z",
        },
      ),
    ).resolves.toBe(true);

    const transaction = send.mock.calls[0]?.[0].input.TransactItems;
    expect(transaction).toHaveLength(3);
    expect(transaction[0].Put.Item).toMatchObject({
      pk: "PLAYER#player-a",
      sk: "XP#FEATURED#2026-08-21",
      award,
    });
    expect(transaction[1].Update.ExpressionAttributeValues[":amount"]).toBe(5);
    expect(transaction[2].Update.UpdateExpression).toContain("xpAwards");
  });

  it("treats an existing XP marker as a successful duplicate", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({ Item: { pk: "PLAYER#player-a" } });

    await expect(
      new Repository("test-table").grantXpOnce(
        "player-a",
        "SEASON-CIRCUIT#2026-08",
        { source: "season-circuit", label: "Seasonal Circuit", amount: 100 },
        "2026-09-07T10:00:00.000Z",
      ),
    ).resolves.toBe(false);
  });

  it("enforces the personal-best UTC-day cap without consuming the run marker", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { personalBestAwards: 3 } });

    await expect(
      new Repository("test-table").grantDailyPersonalBestXp(
        "player-a",
        "2026-08-21",
        { runId: "run-4", completedAt: "2026-08-21T20:00:00.000Z" },
        { source: "personal-best", label: "New personal best", amount: 10 },
        "2026-08-21T20:00:00.000Z",
        3,
      ),
    ).resolves.toBe(false);
  });

  it("folds Practice's odd-card carry into the run transaction", async () => {
    const run: RunItem = {
      pk: "RUN#practice-2",
      sk: "RUN",
      runId: "practice-2",
      owner: "player-a",
      mode: "practice",
      challenge: { mode: "practice", cardIds: [26000000] },
      state: "started",
      startedAt: "2026-08-21T12:00:00.000Z",
      expiresAt: 1_900_000_000,
      ranked: false,
      answerCount: 1,
    };
    send
      .mockResolvedValueOnce({
        Item: { version: 2, cards: 5, carriedCards: 1 },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Item: {
          sub: "player-a",
          playerId: "public-a",
          email: "a@example.com",
          totalGames: 2,
          xp: 11,
        },
      });

    const result = await new Repository("test-table").completeRun(
      run,
      100,
      "2026-08",
      { practiceCards: 1 },
    );

    expect(result.xpAward).toBe(1);
    const transaction = send.mock.calls[1]?.[0].input.TransactItems;
    expect(transaction[2].Put.Item).toMatchObject({
      xp: 1,
      xpAwards: [{ source: "practice", amount: 1 }],
    });
    expect(transaction[3].Update.ExpressionAttributeValues[":xp"]).toBe(1);
    expect(transaction[4].Put.Item).toMatchObject({
      sk: "XP#PRACTICE",
      version: 3,
      cards: 6,
      carriedCards: 0,
    });
  });
});
