import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({ send }),
    },
  };
});

import { HttpError } from "../src/errors.js";
import {
  allTimeLeaderboard,
  seasonLeaderboard,
  seasonPodiumFinishers,
} from "../src/leaderboards.js";

// GET /leaderboards is public and unauthenticated, so no read on that path may
// walk a partition without a bound. These are the guards for that: a player
// with a pathological run history must cost a fixed number of queries, not a
// scan proportional to how much they have played.
describe("leaderboard read bounds", () => {
  beforeEach(() => {
    send.mockReset();
  });

  function queryPage(items: Array<Record<string, unknown>>, more = true) {
    return {
      Items: items,
      ...(more ? { LastEvaluatedKey: { pk: "cursor", sk: "cursor" } } : {}),
    };
  }

  function historyRow(index: number, overrides: Record<string, unknown> = {}) {
    return {
      pk: "PLAYER#grinder",
      sk: `RUN#2026-06-01T00:00:00.000Z#run-${index}`,
      runId: `run-${index}`,
      playerSub: "grinder",
      mode: "surge",
      score: 50_000 + index,
      completedAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("stops the season board after ten pages instead of scanning forever", async () => {
    // Every page is one already-seen player, so the board never fills and only
    // the page cap can end the walk.
    send.mockResolvedValue(
      queryPage([
        {
          runId: "run-repeat",
          playerSub: "grinder",
          score: 10_000,
          completedAt: "2026-06-01T00:00:00.000Z",
        },
      ]),
    );

    const entries = await seasonLeaderboard(
      "test-table",
      "surge",
      "2026-06",
      50,
    );

    // 10 board pages, each with its own decision BatchGet, then one profile
    // hydration — and nothing more.
    expect(send).toHaveBeenCalledTimes(21);
    expect(entries).toHaveLength(1);
  });

  it("bounds the legacy all-time run lookup and reports it as unavailable", async () => {
    // A legacy all-time row carries no runId, so it has to be matched back to
    // the earning run in the player's history. That history never matches here.
    send.mockImplementation((command) => {
      const input = command.input as {
        IndexName?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
      if (input.IndexName === "GSI1")
        return Promise.resolve({
          Items: [
            {
              playerSub: "grinder",
              score: 99_999,
              completedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        });
      return Promise.resolve(queryPage([historyRow(1, { score: 1 })]));
    });

    await expect(
      allTimeLeaderboard("test-table", "surge", 50),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "leaderboard_history_unavailable",
    });
    // One board query plus exactly four capped history pages.
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("resolves a legacy all-time row that appears on the last allowed page", async () => {
    let historyPages = 0;
    send.mockImplementation((command) => {
      const input = command.input as {
        IndexName?: string;
        RequestItems?: Record<string, unknown>;
      };
      if (input.IndexName === "GSI1")
        return Promise.resolve({
          Items: [
            {
              playerSub: "grinder",
              score: 99_999,
              completedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        });
      if (input.RequestItems) return Promise.resolve({ Responses: {} });
      historyPages += 1;
      return Promise.resolve(
        queryPage(
          historyPages === 4
            ? [historyRow(4, { score: 99_999 })]
            : [historyRow(historyPages, { score: 1 })],
          historyPages < 4,
        ),
      );
    });

    const entries = await allTimeLeaderboard("test-table", "surge", 50);

    expect(historyPages).toBe(4);
    expect(entries).toMatchObject([{ rank: 1, score: 99_999 }]);
  });

  it("stops reading decisions once the best visible run is found", async () => {
    const hiddenRuns = Array.from({ length: 250 }, (_, index) =>
      historyRow(index, { score: 90_000 - index }),
    );
    const decisionBatches: number[] = [];
    send.mockImplementation((command) => {
      const input = command.input as {
        IndexName?: string;
        RequestItems?: Record<string, { Keys?: unknown[] }>;
      };
      if (input.IndexName === "GSI1")
        return Promise.resolve({
          Items: [
            {
              runId: "run-hidden",
              playerSub: "grinder",
              score: 99_999,
              completedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        });
      if (input.RequestItems) {
        const keys = input.RequestItems["test-table"]?.Keys ?? [];
        if (
          keys.every((key) =>
            String((key as { pk: string }).pk).startsWith("REFEREE#"),
          )
        )
          decisionBatches.push(keys.length);
        // Only the all-time row itself is hidden; every history run is visible.
        return Promise.resolve({
          Responses: {
            "test-table": keys.some(
              (key) => (key as { pk: string }).pk === "REFEREE#run-hidden",
            )
              ? [
                  {
                    pk: "REFEREE#run-hidden",
                    sk: "CURRENT",
                    runId: "run-hidden",
                    visibility: "hidden",
                  },
                ]
              : [],
          },
        });
      }
      return Promise.resolve(queryPage(hiddenRuns, false));
    });

    const entries = await allTimeLeaderboard("test-table", "surge", 50);

    // The fallback ranks all 250 candidates but only ever reads one 100-key
    // batch of decisions: the batch is taken from the RANKED list, so the best
    // visible run is settled before the other 150 are ever looked at.
    // Surge ranks lower-is-better, so the winner is the smallest score.
    expect(decisionBatches).toEqual([1, 100]);
    expect(entries).toMatchObject([{ rank: 1, score: 89_751 }]);
  });

  it("gives up on a player whose whole visible history is hidden", async () => {
    const runs = Array.from({ length: 600 }, (_, index) =>
      historyRow(index, { score: 90_000 - index }),
    );
    send.mockImplementation((command) => {
      const input = command.input as {
        IndexName?: string;
        RequestItems?: Record<string, { Keys?: Array<{ pk: string }> }>;
      };
      if (input.IndexName === "GSI1")
        return Promise.resolve({
          Items: [
            {
              runId: "run-hidden",
              playerSub: "grinder",
              score: 99_999,
              completedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        });
      if (input.RequestItems) {
        const keys = input.RequestItems["test-table"]?.Keys ?? [];
        return Promise.resolve({
          Responses: {
            "test-table": keys.map((key) => ({
              ...key,
              runId: key.pk.slice("REFEREE#".length),
              visibility: "hidden",
            })),
          },
        });
      }
      return Promise.resolve(queryPage(runs, false));
    });

    const entries = await allTimeLeaderboard("test-table", "surge", 50);

    // The player simply drops off the board rather than costing an unbounded
    // number of decision reads.
    expect(entries).toEqual([]);
  });

  it("surfaces an incomplete decision read as a retryable 503", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a",
            playerSub: "player-a",
            score: 10_000,
            completedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValue({
        Responses: { "test-table": [] },
        UnprocessedKeys: {
          "test-table": { Keys: [{ pk: "REFEREE#run-a", sk: "CURRENT" }] },
        },
      });

    const error = await seasonLeaderboard(
      "test-table",
      "surge",
      "2026-06",
      50,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 503,
      code: "leaderboard_review_unavailable",
    });
  });

  it("refuses to rank a season row whose run is missing", async () => {
    send.mockResolvedValueOnce({
      Items: [
        { playerSub: "player-a", score: 10_000, completedAt: "2026-06-01" },
      ],
    });

    await expect(
      seasonLeaderboard("test-table", "surge", "2026-06", 50),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "leaderboard_history_unavailable",
    });
  });

  it("returns referee-visible podium subjects without profile hydration", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a",
            playerSub: "player-a",
            score: 10_000,
            completedAt: "2026-06-01T00:00:00.000Z",
          },
          {
            runId: "run-b",
            playerSub: "player-b",
            score: 11_000,
            completedAt: "2026-06-01T00:00:01.000Z",
          },
          {
            runId: "run-c",
            playerSub: "player-c",
            score: 12_000,
            completedAt: "2026-06-01T00:00:02.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: {} });

    await expect(
      seasonPodiumFinishers("test-table", "surge", "2026-06"),
    ).resolves.toEqual(["player-a", "player-b", "player-c"]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

// A board row publishes a time only where time is that board's ONLY tiebreak.
// Higher/Lower ranks equal scores by lives lost first, so a row showing just the
// time would order visible ties in a way the row cannot explain.
describe("leaderboard row tiebreak display", () => {
  beforeEach(() => {
    send.mockReset();
  });

  function boardWith(mode: string) {
    send.mockImplementation((command: { input: { IndexName?: string } }) => {
      if (command.input.IndexName === "GSI1")
        return Promise.resolve({
          Items: [
            {
              runId: "run-a",
              playerSub: "player-a",
              mode,
              score: 26,
              completedAt: "2026-07-25T00:00:00.000Z",
              livesLost: 1,
              timeMs: 31_400,
            },
          ],
        });
      return Promise.resolve({ Responses: {} });
    });
    return seasonLeaderboard("test-table", mode as never, "2026-07", 50);
  }

  it("shows Survival's cumulative time, its single tiebreak", async () => {
    expect(await boardWith("survival")).toMatchObject([{ timeMs: 31_400 }]);
  });

  it("publishes no time on the two-tiebreak Higher/Lower board", async () => {
    const rows = await boardWith("higher-lower");
    expect(rows[0]).toMatchObject({ rank: 1, score: 26 });
    expect(rows[0]).not.toHaveProperty("timeMs");
    expect(rows[0]).not.toHaveProperty("livesLost");
  });
});
