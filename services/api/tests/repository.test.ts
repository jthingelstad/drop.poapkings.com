import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { leaderboardSortKey } from "../src/games.js";
import { Repository, type RunItem } from "../src/repository.js";

describe("repository DynamoDB requests", () => {
  beforeEach(() => {
    send.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("looks up a public player by pseudonymous id without returning private fields", async () => {
    send.mockResolvedValueOnce({
      Items: [
        {
          pk: "PLAYER#private-sub",
          sk: "PROFILE",
          playerId: "player-public-id",
          publicName: "Royal Ghosted",
          favoriteCardId: 26000050,
          playerTag: "#ABC123",
          totalGames: 42,
          xp: 900,
        },
      ],
    });

    const result = await new Repository("test-table").getPublicPlayer(
      "player-public-id",
    );

    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      TableName: "test-table",
      IndexName: "GSI3",
      KeyConditionExpression: "playerId = :playerId",
      ExpressionAttributeValues: { ":playerId": "player-public-id" },
      Limit: 1,
    });
    expect(result).toMatchObject({
      sub: "private-sub",
      player: {
        id: "player-public-id",
        publicName: "Royal Ghosted",
        favoriteCardId: 26000050,
        playerTag: "#ABC123",
        totalGames: 42,
        xp: 900,
      },
    });
    expect(result?.player).not.toHaveProperty("email");
    expect(result?.player).not.toHaveProperty("sub");
  });

  it("groups recent activity by player and mode before applying diversity limits", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-07-22T15:00:00.000Z").getTime(),
    );
    send
      .mockResolvedValueOnce({
        Items: [
          {
            playerSub: "player-a",
            mode: "surge",
            score: 20_000,
            completedAt: "2026-07-22T14:55:00.000Z",
          },
          {
            playerSub: "player-a",
            mode: "surge",
            score: 18_000,
            completedAt: "2026-07-22T14:54:00.000Z",
          },
          {
            playerSub: "player-a",
            mode: "rain",
            score: 12,
            completedAt: "2026-07-22T14:53:00.000Z",
          },
          {
            playerSub: "player-a",
            mode: "rain",
            score: 15,
            completedAt: "2026-07-22T14:52:30.000Z",
          },
          {
            playerSub: "player-a",
            mode: "survival",
            score: 5,
            completedAt: "2026-07-22T14:52:00.000Z",
          },
        ],
        LastEvaluatedKey: { pk: "FEED#2026-07", sk: "cursor" },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            playerSub: "player-b",
            mode: "trade",
            score: 13_000,
            completedAt: "2026-07-22T14:51:00.000Z",
          },
          {
            playerSub: "player-c",
            mode: "higher-lower",
            score: 7,
            completedAt: "2026-07-22T14:50:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 20,
            },
            {
              sub: "player-b",
              playerId: "p-b",
              publicName: "Bolt",
              totalGames: 8,
            },
            {
              sub: "player-c",
              playerId: "p-c",
              publicName: "Crown",
              totalGames: 4,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").recentActivity(
      "2026-07",
      4,
    );

    const firstQuery = send.mock.calls[0]?.[0].input;
    expect(firstQuery.KeyConditionExpression).toBe("pk = :pk AND sk >= :since");
    expect(firstQuery.ExpressionAttributeValues).toMatchObject({
      ":pk": "FEED#2026-07",
      ":since": "2026-07-21T15:00:00.000Z",
    });
    expect(send.mock.calls[1]?.[0].input.ExclusiveStartKey).toEqual({
      pk: "FEED#2026-07",
      sk: "cursor",
    });
    expect(entries).toMatchObject([
      {
        mode: "surge",
        score: 18_000,
        achievedAt: "2026-07-22T14:55:00.000Z",
        runCount: 2,
        player: { publicName: "Ace" },
      },
      {
        mode: "rain",
        score: 15,
        runCount: 2,
        player: { publicName: "Ace" },
      },
      {
        mode: "trade",
        score: 13_000,
        runCount: 1,
        player: { publicName: "Bolt" },
      },
      {
        mode: "higher-lower",
        score: 7,
        runCount: 1,
        player: { publicName: "Crown" },
      },
    ]);
    expect(entries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ mode: "survival" })]),
    );
  });

  it("aliases the reserved profile subject attribute in leaderboard reads", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-1",
            playerSub: "player-sub",
            score: 12.3,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
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
    const batchGet = send.mock.calls[2]?.[0];
    const request = batchGet.input.RequestItems["test-table"];

    expect(request.ProjectionExpression).toContain("#sub");
    expect(request.ExpressionAttributeNames).toEqual({ "#sub": "sub" });
    expect(entries).toMatchObject([{ player: { publicName: "Knight Ace" } }]);
  });

  it("filters legacy zero-score rows from seasonal leaderboard reads", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-zero",
            playerSub: "player-zero",
            score: 0,
            completedAt: "2026-07-18T11:59:00.000Z",
          },
          {
            runId: "run-positive",
            playerSub: "player-positive",
            score: 1,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-positive",
              playerId: "positive",
              publicName: "Earned It",
              totalGames: 1,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").leaderboard(
      "higher-lower",
      "2026-07",
      10,
    );

    expect(entries).toMatchObject([
      { rank: 1, score: 1, player: { publicName: "Earned It" } },
    ]);
    const decisionKeys =
      send.mock.calls[1]?.[0].input.RequestItems["test-table"].Keys;
    expect(decisionKeys).toEqual([
      { pk: "REFEREE#run-positive", sk: "CURRENT" },
    ]);
  });

  it("hides a referee-reviewed season run and promotes the next visible scores", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a-hidden",
            playerSub: "player-a",
            score: 10_000,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
          {
            runId: "run-b",
            playerSub: "player-b",
            score: 12_000,
            completedAt: "2026-07-18T12:01:00.000Z",
          },
          {
            runId: "run-a-visible",
            playerSub: "player-a",
            score: 13_000,
            completedAt: "2026-07-18T12:02:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              pk: "REFEREE#run-a-hidden",
              sk: "CURRENT",
              runId: "run-a-hidden",
              visibility: "hidden",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 9,
            },
            {
              sub: "player-b",
              playerId: "p-b",
              publicName: "Bolt",
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
    const decisionRead = send.mock.calls[1]?.[0];
    expect(decisionRead.input.RequestItems["test-table"].ConsistentRead).toBe(
      true,
    );

    expect(entries).toMatchObject([
      { rank: 1, score: 12_000, player: { publicName: "Bolt" } },
      { rank: 2, score: 13_000, player: { publicName: "Ace" } },
    ]);
  });

  it("restores an approved run to its correct leaderboard rank", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-approved",
            playerSub: "player-a",
            score: 10_000,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
          {
            runId: "run-b",
            playerSub: "player-b",
            score: 12_000,
            completedAt: "2026-07-18T12:01:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              pk: "REFEREE#run-approved",
              sk: "CURRENT",
              runId: "run-approved",
              disposition: "clear",
              visibility: "visible",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 9,
            },
            {
              sub: "player-b",
              playerId: "p-b",
              publicName: "Bolt",
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

    expect(entries).toMatchObject([
      { rank: 1, score: 10_000, player: { publicName: "Ace" } },
      { rank: 2, score: 12_000, player: { publicName: "Bolt" } },
    ]);
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

  it("keeps a third CR season in one month distinct from the first", async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          crSeasonId: 135,
          leaderboardSeasonId: "2026-07-135",
        },
      })
      .mockResolvedValueOnce({});

    await new Repository("test-table").saveCrWarClock({
      crSeasonId: 136,
      sectionIndex: 0,
      periodIndex: 0,
      periodType: "training",
      seasonStartsAt: "2026-07-30T10:00:00.000Z",
      observedAt: "2026-07-30T10:05:00.000Z",
      sourceClanTag: "#J2RGCRVG",
    });
    const put = send.mock.calls[1]?.[0];

    // Falling back to the bare calendar id here would collide with the
    // month's first season and merge two leaderboards.
    expect(put.input.Item.leaderboardSeasonId).toBe("2026-07-136");
    // The save is also guarded against a concurrent CR-season change.
    expect(put.input.ConditionExpression).toContain("crSeasonId");
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

    await new Repository("test-table").completeRun(run, 12.3, "2026-07", 45);

    const transaction = send.mock.calls[0]?.[0];
    const globalUpdate = transaction.input.TransactItems[1]?.Update;
    const profileUpdate = transaction.input.TransactItems[3]?.Update;
    expect(profileUpdate?.UpdateExpression).toContain(
      "ADD totalGames :one, xp :xp",
    );
    expect(profileUpdate?.ExpressionAttributeValues[":xp"]).toBe(45);
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

  it("atomically hides an integrity-flagged ranked run for referee review", async () => {
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
      pk: "RUN#run-review",
      sk: "RUN",
      runId: "run-review",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [26000000] },
      state: "started",
      startedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: 1_800_000_000,
    };

    await new Repository("test-table").completeRun(
      run,
      1_000,
      "2026-07",
      45,
      undefined,
      "score_below_ui_floor",
    );

    const items = send.mock.calls[0]?.[0].input.TransactItems;
    expect(items).toHaveLength(6);
    const history = items[4]?.Put;
    const current = items[5]?.Put;
    expect(history?.Item).toMatchObject({
      pk: "REFEREE#run-review",
      runId: "run-review",
      disposition: "review",
      visibility: "hidden",
      reason: "score_below_ui_floor",
      decidedBy: "integrity-gate",
      schemaVersion: "1",
    });
    expect(history?.Item.sk).toMatch(/^DECISION#/);
    expect(history?.Item.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(history?.ConditionExpression).toBe("attribute_not_exists(pk)");
    expect(current?.Item).toMatchObject({
      pk: "REFEREE#run-review",
      sk: "CURRENT",
      runId: "run-review",
      visibility: "hidden",
    });
    expect(current?.Item.decidedAt).toBe(history?.Item.decidedAt);
  });

  it("records an unranked run's history without a leaderboard entry", async () => {
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
      pk: "RUN#run-practice",
      sk: "RUN",
      runId: "run-practice",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [26000000] },
      state: "started",
      startedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: 1_800_000_000,
      ranked: false,
    };

    await new Repository("test-table").completeRun(run, 12.3, "2026-07", 20);

    const transaction = send.mock.calls[0]?.[0];
    const history = transaction.input.TransactItems[2]?.Put?.Item;
    // History, totals, and Trophy Road still record; only ranking is skipped.
    expect(history?.score).toBe(12.3);
    expect(history?.GSI1PK).toBeUndefined();
    expect(history?.GSI1SK).toBeUndefined();
    const globalUpdate = transaction.input.TransactItems[1]?.Update;
    expect(globalUpdate?.UpdateExpression).toContain("trophyRoadGames");
  });

  it("records a zero-score ranked run without projecting it to a leaderboard", async () => {
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
      pk: "RUN#run-zero",
      sk: "RUN",
      runId: "run-zero",
      owner: "player-sub",
      mode: "higher-lower",
      challenge: {
        mode: "higher-lower",
        pairs: [[26000000, 26000001]],
      },
      state: "started",
      startedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: 1_800_000_000,
    };

    await new Repository("test-table").completeRun(run, 0, "2026-07", 1);

    const transaction = send.mock.calls[0]?.[0];
    const history = transaction.input.TransactItems[2]?.Put?.Item;
    expect(history).toMatchObject({ runId: "run-zero", score: 0 });
    expect(history?.GSI1PK).toBeUndefined();
    expect(history?.GSI1SK).toBeUndefined();
    expect(
      transaction.input.TransactItems[1]?.Update?.UpdateExpression,
    ).toContain("trophyRoadGames");
    expect(
      transaction.input.TransactItems[3]?.Update?.ExpressionAttributeValues[
        ":xp"
      ],
    ).toBe(1);
  });

  it("deletes the player partition, CR snapshot, and profile last", async () => {
    send
      .mockResolvedValueOnce({
        Item: { totalGames: 42, playerTag: "#2PYQ0" },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            pk: "PLAYER#player-sub",
            sk: "RUN#2026-07-18T12:00:00.000Z#run-1",
            runId: "run-1",
            GSI1PK: "LEADERBOARD#2026-07#surge",
          },
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          { pk: "REFEREE#run-1", sk: "CURRENT" },
          {
            pk: "REFEREE#run-1",
            sk: "DECISION#2026-07-18T12:05:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").deleteAccount("player-sub"),
    ).resolves.toEqual({ deletedGames: 42 });

    // The profile is only read up front; it must be deleted after the sweep
    // so a mid-sweep failure stays retryable with the account intact.
    const firstCall = send.mock.calls[0]?.[0].input;
    expect(firstCall.Key).toEqual({ pk: "PLAYER#player-sub", sk: "PROFILE" });
    expect(firstCall.ReturnValues).toBeUndefined();
    const batch = send.mock.calls[3]?.[0].input.RequestItems["test-table"];
    expect(batch).toEqual(
      expect.arrayContaining([
        {
          DeleteRequest: {
            Key: {
              pk: "PLAYER#player-sub",
              sk: "RUN#2026-07-18T12:00:00.000Z#run-1",
            },
          },
        },
        { DeleteRequest: { Key: { pk: "RUN#run-1", sk: "RUN" } } },
        {
          DeleteRequest: { Key: { pk: "REFEREE#run-1", sk: "CURRENT" } },
        },
        {
          DeleteRequest: {
            Key: {
              pk: "REFEREE#run-1",
              sk: "DECISION#2026-07-18T12:05:00.000Z",
            },
          },
        },
      ]),
    );
    expect(JSON.stringify(batch)).not.toContain('"pk":"GLOBAL"');
    // The privacy page promises deletion removes CR-derived data too.
    const snapshotDelete = send.mock.calls[4]?.[0].input;
    expect(snapshotDelete.Key).toEqual({
      pk: "CR_PLAYER##2PYQ0",
      sk: "PROFILE",
    });
    const profileDelete = send.mock.calls[5]?.[0].input;
    expect(profileDelete.Key).toEqual({
      pk: "PLAYER#player-sub",
      sk: "PROFILE",
    });
  });

  it("sweeps referee evidence and decision history when deleting the account", async () => {
    send
      .mockResolvedValueOnce({ Item: { totalGames: 3 } })
      .mockResolvedValueOnce({
        Items: [
          {
            pk: "PLAYER#player-sub",
            sk: "EVIDENCE#2026-07-18T12:01:00.000Z#run-1",
            runId: "run-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          { pk: "REFEREE#run-1", sk: "CURRENT" },
          {
            pk: "REFEREE#run-1",
            sk: "DECISION#2026-07-18T12:05:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await new Repository("test-table").deleteAccount("player-sub");

    const batch = send.mock.calls[3]?.[0].input.RequestItems["test-table"];
    // The player query returns EVIDENCE#; the follow-up REFEREE# query adds the
    // independent current decision and its audit history to the same sweep.
    expect(batch).toEqual(
      expect.arrayContaining([
        {
          DeleteRequest: {
            Key: {
              pk: "PLAYER#player-sub",
              sk: "EVIDENCE#2026-07-18T12:01:00.000Z#run-1",
            },
          },
        },
        // Its runId also enqueues the ephemeral RUN# row for deletion.
        { DeleteRequest: { Key: { pk: "RUN#run-1", sk: "RUN" } } },
        {
          DeleteRequest: { Key: { pk: "REFEREE#run-1", sk: "CURRENT" } },
        },
        {
          DeleteRequest: {
            Key: {
              pk: "REFEREE#run-1",
              sk: "DECISION#2026-07-18T12:05:00.000Z",
            },
          },
        },
      ]),
    );
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

  const allTimeRun: RunItem = {
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

  it("writes a best-ever item guarded by the sort-key condition", async () => {
    send.mockResolvedValueOnce({});

    await new Repository("test-table").updateAllTimeBest(
      allTimeRun,
      12_300,
      undefined,
      "2026-07-18T12:05:00.000Z",
    );

    const update = send.mock.calls[0]?.[0].input;
    expect(update.Key).toEqual({
      pk: "PLAYER#player-sub",
      sk: "ALLTIME#surge",
    });
    expect(update.ConditionExpression).toBe(
      "attribute_not_exists(GSI1SK) OR :newSk < GSI1SK",
    );
    expect(update.ExpressionAttributeValues[":gsi1pk"]).toBe(
      "LEADERBOARD#ALLTIME#surge",
    );
    expect(update.ExpressionAttributeValues[":newSk"]).toBe(
      leaderboardSortKey(
        "surge",
        12_300,
        "2026-07-18T12:05:00.000Z",
        "player-sub",
      ),
    );
    expect(update.ExpressionAttributeValues[":playerSub"]).toBe("player-sub");
    // The earning run id is written so an all-time entry resolves to its run.
    expect(update.UpdateExpression).toContain("runId = :runId");
    expect(update.ExpressionAttributeValues[":runId"]).toBe("run-1");
    // No Survival tiebreak here, so timeMs must not be written.
    expect(update.UpdateExpression).not.toContain("timeMs");
  });

  it("does not create an all-time projection for a zero score", async () => {
    await new Repository("test-table").updateAllTimeBest(
      { ...allTimeRun, mode: "higher-lower" },
      0,
      undefined,
      "2026-07-18T12:05:00.000Z",
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("stores the Survival cumulative time and its partition epoch", async () => {
    send.mockResolvedValueOnce({});

    await new Repository("test-table").updateAllTimeBest(
      { ...allTimeRun, mode: "survival" },
      40,
      95_400,
      "2026-07-18T12:05:00.000Z",
    );

    const update = send.mock.calls[0]?.[0].input;
    expect(update.Key.sk).toBe("ALLTIME#survival");
    expect(update.ExpressionAttributeValues[":gsi1pk"]).toBe(
      "LEADERBOARD#ALLTIME#survival#r2",
    );
    expect(update.ExpressionAttributeValues[":timeMs"]).toBe(95_400);
    expect(update.UpdateExpression).toContain("timeMs = :timeMs");
  });

  it("swallows a worse run that fails the all-time condition", async () => {
    const conditionFailed = new Error("The conditional request failed");
    conditionFailed.name = "ConditionalCheckFailedException";
    send.mockRejectedValueOnce(conditionFailed);

    await expect(
      new Repository("test-table").updateAllTimeBest(
        allTimeRun,
        99_000,
        undefined,
        "2026-07-18T12:05:00.000Z",
      ),
    ).resolves.toBeUndefined();
  });

  it("ranks the all-time board one row per player with no dedup", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a",
            playerSub: "player-a",
            score: 11_000,
            completedAt: "2026-06-01T12:00:00.000Z",
          },
          {
            runId: "run-b",
            playerSub: "player-b",
            score: 12_000,
            completedAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 9,
            },
            {
              sub: "player-b",
              playerId: "p-b",
              publicName: "Bolt",
              totalGames: 4,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").allTimeLeaderboard(
      "surge",
      10,
    );

    const query = send.mock.calls[0]?.[0].input;
    expect(query.IndexName).toBe("GSI1");
    expect(query.ExpressionAttributeValues[":pk"]).toBe(
      "LEADERBOARD#ALLTIME#surge",
    );
    expect(query.Limit).toBe(200);
    expect(entries).toMatchObject([
      { rank: 1, score: 11_000, player: { publicName: "Ace" } },
      { rank: 2, score: 12_000, player: { publicName: "Bolt" } },
    ]);
  });

  it("filters legacy zero-score all-time projections", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-positive",
            playerSub: "player-positive",
            score: 4,
            completedAt: "2026-07-18T12:00:00.000Z",
          },
          {
            runId: "run-zero",
            playerSub: "player-zero",
            score: 0,
            completedAt: "2026-07-18T12:01:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-positive",
              playerId: "positive",
              publicName: "Earned It",
              totalGames: 1,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").allTimeLeaderboard(
      "survival",
      10,
    );

    expect(entries).toMatchObject([
      { rank: 1, score: 4, player: { publicName: "Earned It" } },
    ]);
  });

  it("resolves a legacy all-time row to its immutable earning run", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            playerSub: "player-a",
            score: 11_000,
            completedAt: "2026-06-01T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a-legacy",
            playerSub: "player-a",
            mode: "surge",
            score: 11_000,
            completedAt: "2026-06-01T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 9,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").allTimeLeaderboard(
      "surge",
      10,
    );

    const historyQuery = send.mock.calls[1]?.[0].input;
    expect(historyQuery.ExpressionAttributeValues).toMatchObject({
      ":pk": "PLAYER#player-a",
      ":prefix": "RUN#",
    });
    const decisionRead = send.mock.calls[2]?.[0].input;
    expect(decisionRead.RequestItems["test-table"].Keys).toContainEqual({
      pk: "REFEREE#run-a-legacy",
      sk: "CURRENT",
    });
    expect(entries).toMatchObject([
      { rank: 1, score: 11_000, player: { publicName: "Ace" } },
    ]);
  });

  it("uses the next-best visible run when an all-time best is hidden", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a-hidden",
            playerSub: "player-a",
            score: 10_000,
            completedAt: "2026-06-01T12:00:00.000Z",
            GSI1SK: "000010000",
          },
          {
            runId: "run-b",
            playerSub: "player-b",
            score: 12_000,
            completedAt: "2026-07-01T12:00:00.000Z",
            GSI1SK: "000012000",
          },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              pk: "REFEREE#run-a-hidden",
              sk: "CURRENT",
              runId: "run-a-hidden",
              visibility: "hidden",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            runId: "run-a-fallback",
            playerSub: "player-a",
            mode: "surge",
            score: 13_000,
            completedAt: "2026-05-01T12:00:00.000Z",
            GSI1SK: "000013000",
          },
        ],
      })
      .mockResolvedValueOnce({ Responses: { "test-table": [] } })
      .mockResolvedValueOnce({
        Responses: {
          "test-table": [
            {
              sub: "player-a",
              playerId: "p-a",
              publicName: "Ace",
              totalGames: 9,
            },
            {
              sub: "player-b",
              playerId: "p-b",
              publicName: "Bolt",
              totalGames: 4,
            },
          ],
        },
      });

    const entries = await new Repository("test-table").allTimeLeaderboard(
      "surge",
      10,
    );

    expect(entries).toMatchObject([
      { rank: 1, score: 12_000, player: { publicName: "Bolt" } },
      { rank: 2, score: 13_000, player: { publicName: "Ace" } },
    ]);
  });
});
