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

  it("stores quarantined evidence without touching progress or leaderboards", async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Item: {
        sub: "player-sub",
        playerId: "player-1",
        email: "player@example.com",
        totalGames: 4,
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
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

    await new Repository("test-table").quarantineRun(
      run,
      4_000,
      "2026-07",
      "score_below_ui_floor",
      { wallElapsedMs: 10_000, answerCount: 15 },
    );

    const update = send.mock.calls[0]?.[0].input;
    expect(update.TransactItems).toBeUndefined();
    expect(update.Key).toEqual({ pk: "RUN#run-review", sk: "RUN" });
    expect(update.UpdateExpression).toContain("reviewReason = :reviewReason");
    expect(update.ExpressionAttributeValues).toMatchObject({
      ":quarantined": "quarantined",
      ":reviewReason": "score_below_ui_floor",
      ":integrityEvidence": { wallElapsedMs: 10_000, answerCount: 15 },
    });
    expect(JSON.stringify(update)).not.toContain("LEADERBOARD#");
    expect(JSON.stringify(update)).not.toContain("trophyRoadGames");

    // The evidence must survive the short started-run TTL and be queryable
    // from the review queue partition — otherwise "review quarantined
    // scores" is fiction.
    expect(update.UpdateExpression).toContain("expiresAt = :reviewExpiresAt");
    const twentyNineDays = Math.floor(Date.now() / 1_000) + 29 * 24 * 60 * 60;
    expect(
      Number(update.ExpressionAttributeValues[":reviewExpiresAt"]),
    ).toBeGreaterThan(twentyNineDays);
    expect(update.ExpressionAttributeValues[":queuePk"]).toBe("QUARANTINE");
    expect(update.ExpressionAttributeValues[":queueSk"]).toContain(
      "run-review",
    );
  });

  it("lists the quarantine review queue from its sparse index partition", async () => {
    send.mockResolvedValueOnce({
      Items: [{ runId: "run-review", state: "quarantined" }],
    });

    const runs = await new Repository("test-table").listQuarantinedRuns();
    const query = send.mock.calls[0]?.[0].input;

    expect(query.IndexName).toBe("GSI1");
    expect(query.ExpressionAttributeValues).toEqual({ ":pk": "QUARANTINE" });
    expect(query.ScanIndexForward).toBe(false);
    expect(runs).toMatchObject([{ runId: "run-review" }]);
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
    const batch = send.mock.calls[2]?.[0].input.RequestItems["test-table"];
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
      ]),
    );
    expect(JSON.stringify(batch)).not.toContain('"pk":"GLOBAL"');
    // The privacy page promises deletion removes CR-derived data too.
    const snapshotDelete = send.mock.calls[3]?.[0].input;
    expect(snapshotDelete.Key).toEqual({
      pk: "CR_PLAYER##2PYQ0",
      sk: "PROFILE",
    });
    const profileDelete = send.mock.calls[4]?.[0].input;
    expect(profileDelete.Key).toEqual({
      pk: "PLAYER#player-sub",
      sk: "PROFILE",
    });
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
