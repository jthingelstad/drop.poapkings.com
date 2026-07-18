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

import { Repository, type RunItem } from "../src/repository.js";

describe("repository DynamoDB requests", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("aliases the reserved profile subject attribute in leaderboard reads", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            playerSub: "player-sub",
            score: 12.3,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-sub",
              playerId: "player-1",
              publicName: "Knight Ace",
              totalGames: 4,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").leaderboard(
      "surge",
      "2026-07",
      10,
    );
    const batchGet = send.mock.calls[1]?.[0];
    const request = batchGet.input.RequestItems["test-table"];

    expect(request.ProjectionExpression).toContain("#sub");
    expect(request.ExpressionAttributeNames).toEqual({ "#sub": "sub" });
    expect(entries).toMatchObject([{ player: { publicName: "Knight Ace" } }]);
  });

  it("marks every claimed Clash Royale refresh as pending", async () => {
    send.mockResolvedValueOnce({});

    await new Repository("test-table").claimCrRefresh(
      "#2PYQ0",
      "job-1",
      "2026-07-18T12:00:00.000Z",
      "2026-07-18T11:00:00.000Z",
      "2026-07-18T11:55:00.000Z",
    );
    const update = send.mock.calls[0]?.[0];

    expect(update.input.UpdateExpression).toContain("#status = :pending");
    expect(update.input.UpdateExpression).not.toContain("if_not_exists");
  });

  it("keeps the existing monthly leaderboard ID when first saving the live clock", async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await new Repository("test-table").saveCrWarClock({
      crSeasonId: 134,
      sectionIndex: 1,
      periodIndex: 12,
      periodType: "warDay",
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: "2026-07-18T19:00:00.000Z",
      sourceClanTag: "#J2RGCRVG",
    });
    const put = send.mock.calls[1]?.[0];

    expect(put.input.Item).toMatchObject({
      pk: "CR_WAR_CLOCK",
      sk: "CURRENT",
      crSeasonId: 134,
      leaderboardSeasonId: "2026-07",
    });
  });

  it("creates a distinct key if CR starts another season in the same month", async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          crSeasonId: 134,
          leaderboardSeasonId: "2026-07",
        },
      })
      .mockResolvedValueOnce({});

    await new Repository("test-table").saveCrWarClock({
      crSeasonId: 135,
      sectionIndex: 0,
      periodIndex: 0,
      periodType: "training",
      seasonStartsAt: "2026-07-27T10:00:00.000Z",
      observedAt: "2026-07-27T10:05:00.000Z",
      sourceClanTag: "#J2RGCRVG",
    });
    const put = send.mock.calls[1]?.[0];

    expect(put.input.Item.leaderboardSeasonId).toBe("2026-07-135");
  });

  it("increments the site-wide completed-game total atomically with an accepted run", async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Item: {
        sub: "player-sub",
        playerId: "player-1",
        email: "player@example.com",
        totalGames: 5,
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:01:00.000Z",
      },
    });
    const run: RunItem = {
      pk: "RUN#run-1",
      sk: "RUN",
      runId: "run-1",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [26000000] },
      state: "started",
      startedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: 1_800_000_000,
    };

    await new Repository("test-table").completeRun(run, 12.3, "2026-07");

    const transaction = send.mock.calls[0]?.[0];
    const globalUpdate = transaction.input.TransactItems[1]?.Update;
    expect(globalUpdate?.Key).toEqual({ pk: "GLOBAL", sk: "STATS" });
    expect(globalUpdate?.UpdateExpression).toContain(
      "trophyRoadGames = if_not_exists(trophyRoadGames, :trophyRoadStart) + :one",
    );
    expect(globalUpdate?.UpdateExpression).toContain("ADD totalGames :one");
    expect(globalUpdate?.ExpressionAttributeValues[":trophyRoadStart"]).toBe(
      592,
    );
    expect(globalUpdate?.UpdateExpression).not.toContain("authenticatedGames");
  });

  it("exposes the seeded Trophy Road counter without leaking internal totals", async () => {
    send.mockResolvedValueOnce({
      Item: {
        totalGames: 3,
        trophyRoadGames: 617,
        authenticatedGames: 999,
      },
    });

    await expect(new Repository("test-table").globalStats()).resolves.toEqual({
      trophyRoadGames: 617,
    });
  });

  it("uses the stable launch seed before the first post-launch game", async () => {
    send.mockResolvedValueOnce({ Item: { totalGames: 3 } });

    await expect(new Repository("test-table").globalStats()).resolves.toEqual({
      trophyRoadGames: 592,
    });
  });
});
