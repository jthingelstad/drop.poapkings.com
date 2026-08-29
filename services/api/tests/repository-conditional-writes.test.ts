import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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

import {
  Repository,
  type PublishedBadgeShareItem,
  type PublishedProfileShareItem,
  type PublishedRunShareItem,
  type RunItem,
} from "../src/repository.js";

function awsError(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(name);
  error.name = name;
  return Object.assign(error, extra);
}

const conditionFailed = () => awsError("ConditionalCheckFailedException");
const transactionCanceled = () => awsError("TransactionCanceledException");

const startedRun: RunItem = {
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

// Every conditional write in the repository is load-bearing: it is what makes a
// replayed run a no-op, a spent magic link unusable, and a concurrent write
// safe. These cover the failure side of each condition, where the wrong mapping
// is expensive — a retryable contention answered as "already recorded" loses a
// player's game, and the reverse invites a double-record.
describe("repository conditional writes", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("maps a failed run condition to a 409, not a retry", async () => {
    send.mockRejectedValueOnce(
      awsError("TransactionCanceledException", {
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
        ],
      }),
    );

    await expect(
      new Repository("test-table").completeRun(startedRun, 12.3, 134, 45),
    ).rejects.toMatchObject({ statusCode: 409, code: "run_conflict" });
  });

  it("maps transaction contention to a retryable 503", async () => {
    // Two players finishing in the same instant collide on the shared
    // GLOBAL#STATS item. That is contention, not a spent run.
    send.mockRejectedValueOnce(
      awsError("TransactionCanceledException", {
        CancellationReasons: [{ Code: "TransactionConflict" }],
      }),
    );

    await expect(
      new Repository("test-table").completeRun(startedRun, 12.3, 134, 45),
    ).rejects.toMatchObject({ statusCode: 503, code: "run_record_busy" });
  });

  it("rethrows an unrecognized transaction failure untranslated", async () => {
    send.mockRejectedValueOnce(awsError("ProvisionedThroughputExceeded"));

    await expect(
      new Repository("test-table").completeRun(startedRun, 12.3, 134, 45),
    ).rejects.toMatchObject({ name: "ProvisionedThroughputExceeded" });
  });

  it("fails loudly when the profile vanishes under a recorded run", async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").completeRun(startedRun, 12.3, 134, 45),
    ).rejects.toThrow("Completed run profile could not be loaded");
  });

  it("advances the last played season only when the monotonic projection changes", async () => {
    send.mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").advanceLastSeasonPlayed("player-sub", 135),
    ).resolves.toBe(true);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      Key: { pk: "PLAYER#player-sub", sk: "PROFILE" },
      UpdateExpression: "SET lastSeasonPlayed = :season",
      ExpressionAttributeValues: { ":season": 135 },
    });
    expect(command.input.ConditionExpression).toContain(
      "lastSeasonPlayed < :season",
    );
  });

  it("skips the external season transition when the profile is already current", async () => {
    send.mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").advanceLastSeasonPlayed("player-sub", 135),
    ).resolves.toBe(false);
  });

  it("rejects an invalid Clash Royale season number before writing", async () => {
    await expect(
      new Repository("test-table").advanceLastSeasonPlayed("player-sub", 0),
    ).rejects.toThrow("positive integer");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a spent or expired magic link with 401, never 500", async () => {
    send.mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").consumeMagicLink("token-hash", 1_800_000),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_magic_link",
    });
  });

  it("stores the email link and code alias atomically with the same expiry", async () => {
    send.mockResolvedValueOnce({});

    await new Repository("test-table").saveMagicLink(
      "token-hash",
      "code-hash",
      "player@example.com",
      1_900_000,
      "poll-id",
      "recruiter-sub",
    );

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toEqual([
      {
        Put: {
          TableName: "test-table",
          Item: {
            pk: "MAGIC#token-hash",
            sk: "MAGIC",
            email: "player@example.com",
            expiresAt: 1_900_000,
            pollId: "poll-id",
            recruiterSub: "recruiter-sub",
          },
        },
      },
      {
        Put: {
          TableName: "test-table",
          Item: {
            pk: "MAGIC_CODE#code-hash",
            sk: "MAGIC_CODE",
            tokenHash: "token-hash",
            expiresAt: 1_900_000,
          },
        },
      },
    ]);
  });

  it("resolves a live email code alias to its single-use token record", async () => {
    send.mockResolvedValueOnce({
      Item: {
        pk: "MAGIC_CODE#code-hash",
        sk: "MAGIC_CODE",
        tokenHash: "token-hash",
        expiresAt: 1_900_000,
      },
    });

    await expect(
      new Repository("test-table").tokenHashForMagicCode(
        "code-hash",
        1_800_000,
      ),
    ).resolves.toBe("token-hash");
  });

  it("rejects a missing or expired email code alias", async () => {
    send.mockResolvedValueOnce({
      Item: {
        tokenHash: "token-hash",
        expiresAt: 1_700_000,
      },
    });

    await expect(
      new Repository("test-table").tokenHashForMagicCode(
        "code-hash",
        1_800_000,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_magic_code",
    });
  });

  it("refuses to redeem a link that was already used", async () => {
    send.mockResolvedValueOnce({
      Item: {
        pk: "MAGIC#hash",
        sk: "MAGIC",
        email: "player@example.com",
        expiresAt: 1_900_000,
        usedAt: "2026-07-18T12:00:00.000Z",
      },
    });

    await expect(
      new Repository("test-table").peekMagicLink("hash", 1_800_000),
    ).rejects.toMatchObject({ statusCode: 401, code: "invalid_magic_link" });
  });

  it("refuses to redeem a link that has expired", async () => {
    send.mockResolvedValueOnce({
      Item: {
        pk: "MAGIC#hash",
        sk: "MAGIC",
        email: "player@example.com",
        expiresAt: 1_700_000,
      },
    });

    await expect(
      new Repository("test-table").peekMagicLink("hash", 1_800_000),
    ).rejects.toMatchObject({ statusCode: 401, code: "invalid_magic_link" });
  });

  it("returns a valid link's email, poll id, and recruiter attribution", async () => {
    send.mockResolvedValueOnce({
      Item: {
        pk: "MAGIC#hash",
        sk: "MAGIC",
        email: "player@example.com",
        expiresAt: 1_900_000,
        pollId: "poll-id",
        recruiterSub: "recruiter-sub",
      },
    });

    await expect(
      new Repository("test-table").peekMagicLink("hash", 1_800_000),
    ).resolves.toEqual({
      email: "player@example.com",
      pollId: "poll-id",
      recruiterSub: "recruiter-sub",
    });
  });

  it("attaches the first recruiter without allowing self-attribution", async () => {
    const repository = new Repository("test-table");
    send.mockResolvedValueOnce({});

    await expect(
      repository.attachRecruiter("recruited-sub", "recruiter-sub"),
    ).resolves.toBe(true);
    await expect(
      repository.attachRecruiter("same-sub", "same-sub"),
    ).resolves.toBe(false);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    if (!(command instanceof UpdateCommand))
      throw new Error("Expected recruiter attribution update");
    expect(command.input).toMatchObject({
      Key: { pk: "PLAYER#recruited-sub", sk: "PROFILE" },
      ConditionExpression:
        "attribute_exists(pk) AND attribute_not_exists(recruitedBy)",
      ExpressionAttributeValues: { ":recruiter": "recruiter-sub" },
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("credits a recruit once with the marker and counter in one transaction", async () => {
    send
      .mockResolvedValueOnce({
        Item: { sub: "recruited-sub", recruitedBy: "recruiter-sub" },
      })
      .mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").creditRecruiter(
        "recruited-sub",
        "2026-08-21T12:00:00.000Z",
      ),
    ).resolves.toBe(true);

    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected recruiter credit transaction");
    expect(command.input.TransactItems).toEqual([
      expect.objectContaining({
        Update: expect.objectContaining({
          Key: { pk: "PLAYER#recruited-sub", sk: "PROFILE" },
          ConditionExpression:
            "recruitedBy = :recruiter AND attribute_not_exists(recruiterCreditedAt)",
        }),
      }),
      expect.objectContaining({
        Update: expect.objectContaining({
          Key: { pk: "PLAYER#recruiter-sub", sk: "PROFILE" },
          UpdateExpression:
            "SET updatedAt = :creditedAt ADD recruiterCount :one",
        }),
      }),
    ]);
  });

  it("indexes an invitation for account deletion without inventing a run", async () => {
    send.mockResolvedValueOnce({});

    await new Repository("test-table").putShare({
      pk: "SHARE#AB2CD3",
      sk: "SHARE",
      token: "AB2CD3",
      kind: "invite",
      owner: "player-sub",
      destination: "home",
      mintedAt: "2026-08-22T12:00:00.000Z",
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected share pointer transaction");
    expect(command.input.TransactItems?.[1]).toEqual({
      Put: expect.objectContaining({
        Item: {
          pk: "PLAYER#player-sub",
          sk: "SHARE#AB2CD3",
          shareToken: "AB2CD3",
          mintedAt: "2026-08-22T12:00:00.000Z",
        },
      }),
    });
  });

  it("publishes canonical IDs, public tags, and the deletion pointer atomically", async () => {
    send.mockResolvedValueOnce({});
    const share: PublishedRunShareItem = {
      pk: "SHARE#RUN#11111111-1111-4111-8111-111111111111#22222222-2222-4222-8222-222222222222",
      sk: "SHARE",
      kind: "published-run",
      owner: "player-sub",
      playerId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      mode: "surge",
      score: 17_412,
      seasonId: 135,
      completedAt: "2026-08-23T12:00:00.000Z",
      publishedAt: "2026-08-23T12:01:00.000Z",
      player: {
        id: "11111111-1111-4111-8111-111111111111",
        publicName: "Drop King",
        xp: 900,
        totalGames: 40,
      },
    };

    await expect(
      new Repository("test-table").putPublishedRunShare(share),
    ).resolves.toBe(true);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected published-share transaction");
    const items = command.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    const canonical = items[0]?.Put?.Item as Record<string, unknown>;
    const alias = items[1]?.Put?.Item as Record<string, unknown>;
    expect(canonical.pk).toBe(share.pk);
    expect(canonical.playerTag).toMatch(/^P[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(canonical.runTag).toMatch(/^D[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(alias.pk).toBe(
      `SHARE#TAG#${canonical.playerTag as string}#${canonical.runTag as string}`,
    );
    expect(items[2]?.Put?.Item).toMatchObject({
      pk: "PLAYER#player-sub",
      sharePlayerId: share.playerId,
      shareRunId: share.runId,
      sharePlayerTag: canonical.playerTag,
      shareRunTag: canonical.runTag,
    });
  });

  it("backfills a public-tag alias and deletion metadata for an older share", async () => {
    send.mockResolvedValueOnce({});
    const share: PublishedRunShareItem = {
      pk: "SHARE#RUN#11111111-1111-4111-8111-111111111111#22222222-2222-4222-8222-222222222222",
      sk: "SHARE",
      kind: "published-run",
      owner: "player-sub",
      playerId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      mode: "surge",
      score: 17_412,
      seasonId: 135,
      completedAt: "2026-08-23T12:00:00.000Z",
      publishedAt: "2026-08-23T12:01:00.000Z",
      player: {
        id: "11111111-1111-4111-8111-111111111111",
        publicName: "Drop King",
        xp: 900,
        totalGames: 40,
      },
    };

    await new Repository("test-table").putPublishedRunShareAlias(share);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected published-share alias transaction");
    expect(command.input.TransactItems).toHaveLength(2);
    expect(command.input.TransactItems?.[0]?.Put?.Item?.pk).toMatch(
      /^SHARE#TAG#P[0-9A-HJKMNP-TV-Z]{10}#D[0-9A-HJKMNP-TV-Z]{10}$/,
    );
    expect(command.input.TransactItems?.[1]?.Update).toMatchObject({
      Key: {
        pk: "PLAYER#player-sub",
        sk: `SHARE#RUN#${share.playerId}#${share.runId}`,
      },
      UpdateExpression:
        "SET sharePlayerTag = :playerTag, shareRunTag = :runTag",
      ConditionExpression: "attribute_exists(pk)",
    });
  });

  it("publishes a badge rung, its public tag alias, and deletion pointer atomically", async () => {
    send.mockResolvedValueOnce({});
    const share: PublishedBadgeShareItem = {
      pk: "SHARE#BADGE#11111111-1111-4111-8111-111111111111#clockbreaker#3",
      sk: "SHARE",
      kind: "published-badge",
      owner: "player-sub",
      playerId: "11111111-1111-4111-8111-111111111111",
      slug: "clockbreaker",
      rungIndex: 3,
      publishedAt: "2026-08-23T12:01:00.000Z",
      player: {
        id: "11111111-1111-4111-8111-111111111111",
        publicName: "Drop King",
        xp: 900,
        totalGames: 40,
      },
      badge: {
        name: "Clockbreaker",
        tier: "copper",
        chip: "35s",
        milestone: 35,
        rungCount: 12,
        earnedAt: "2026-08-23T12:00:00.000Z",
        requirement: "Fastest Surge run",
      },
    };

    await expect(
      new Repository("test-table").putPublishedBadgeShare(share),
    ).resolves.toBe(true);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected published-badge transaction");
    const items = command.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    const canonical = items[0]?.Put?.Item as Record<string, unknown>;
    expect(canonical.playerTag).toMatch(/^P[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(items[1]?.Put?.Item?.pk).toBe(
      `SHARE#TAG#${canonical.playerTag as string}#BADGE#clockbreaker#4`,
    );
    expect(items[2]?.Put?.Item).toMatchObject({
      pk: "PLAYER#player-sub",
      sk: `SHARE#BADGE#${share.playerId}#clockbreaker#3`,
      sharePlayerId: share.playerId,
      sharePlayerTag: canonical.playerTag,
      shareBadgeSlug: "clockbreaker",
      shareBadgeRungIndex: 3,
    });
  });

  it("refreshes a profile, its public tag alias, and deletion pointer atomically", async () => {
    send.mockResolvedValueOnce({});
    const share: PublishedProfileShareItem = {
      pk: "SHARE#PROFILE#11111111-1111-4111-8111-111111111111",
      sk: "SHARE",
      kind: "published-profile",
      owner: "player-sub",
      playerId: "11111111-1111-4111-8111-111111111111",
      publishedAt: "2026-08-23T12:01:00.000Z",
      player: {
        id: "11111111-1111-4111-8111-111111111111",
        publicName: "Drop King",
        xp: 900,
        totalGames: 40,
      },
      arena: 8,
      badgeCount: 1,
      badges: [
        {
          slug: "clockbreaker",
          name: "Clockbreaker",
          tier: "copper",
          chip: "35s",
        },
      ],
    };

    await new Repository("test-table").putPublishedProfileShare(share);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand))
      throw new Error("Expected published-profile transaction");
    const items = command.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    const canonical = items[0]?.Put?.Item as Record<string, unknown>;
    expect(canonical.playerTag).toMatch(/^P[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(items[1]?.Put?.Item?.pk).toBe(
      `SHARE#TAG#${canonical.playerTag as string}`,
    );
    expect(items[2]?.Put?.Item).toMatchObject({
      pk: "PLAYER#player-sub",
      sk: `SHARE#PROFILE#${share.playerId}`,
      sharePlayerId: share.playerId,
      sharePlayerTag: canonical.playerTag,
      shareProfile: true,
    });
  });

  it("does not credit a recruit whose exact-once marker already exists", async () => {
    send.mockResolvedValueOnce({
      Item: {
        sub: "recruited-sub",
        recruitedBy: "recruiter-sub",
        recruiterCreditedAt: "2026-08-21T12:00:00.000Z",
      },
    });

    await expect(
      new Repository("test-table").creditRecruiter(
        "recruited-sub",
        "2026-08-22T12:00:00.000Z",
      ),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it("atomically allocates First Drop when creating an eligible profile", async () => {
    send.mockResolvedValueOnce({});

    const login = await new Repository("test-table").ensureProfile(
      "player-sub",
      "player@example.com",
    );

    expect(login).toMatchObject({
      created: true,
      profile: { firstDrop: true },
    });
    const transaction = send.mock.calls[0]?.[0];
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    if (!(transaction instanceof TransactWriteCommand))
      throw new Error("Expected the First Drop allocation transaction");
    expect(transaction.input.TransactItems).toHaveLength(2);
    expect(transaction.input.TransactItems?.[0]?.Update).toMatchObject({
      Key: { pk: "SYSTEM#FIRST_DROP", sk: "COUNTER" },
      ConditionExpression: "attribute_not_exists(claimed) OR claimed < :limit",
      ExpressionAttributeValues: expect.objectContaining({
        ":baseline": 25,
        ":limit": 100,
      }),
    });
    expect(transaction.input.TransactItems?.[1]?.Put?.Item).toMatchObject({
      pk: "PLAYER#player-sub",
      sk: "PROFILE",
      firstDrop: true,
    });
  });

  it("treats a lost create race as a returning legacy player", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({
        Item: {
          sub: "player-sub",
          playerId: "existing-player",
          email: "player@example.com",
          totalGames: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        Attributes: {
          sub: "player-sub",
          playerId: "existing-player",
          email: "player@example.com",
          totalGames: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          lastLoginAt: "2026-08-13T00:00:00.000Z",
        },
      });

    const login = await new Repository("test-table").ensureProfile(
      "player-sub",
      "player@example.com",
    );

    expect(login.created).toBe(false);
    expect(login.profile.playerId).toBe("existing-player");
    const loginUpdate = send.mock.calls[2]?.[0];
    expect(loginUpdate).toBeInstanceOf(UpdateCommand);
    if (!(loginUpdate instanceof UpdateCommand))
      throw new Error("Expected the returning-player login timestamp update");
    expect(loginUpdate.input.UpdateExpression).toBe(
      "SET lastLoginAt = :lastLoginAt",
    );
  });

  it("retries a contended First Drop allocation while slots remain", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { claimed: 99 } })
      .mockResolvedValueOnce({});

    await expect(
      new Repository("test-table").ensureProfile(
        "player-sub",
        "player@example.com",
      ),
    ).resolves.toMatchObject({ created: true, profile: { firstDrop: true } });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("creates a normal profile without consuming a slot after the first 100", async () => {
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { claimed: 100 } })
      .mockResolvedValueOnce({});

    const login = await new Repository("test-table").ensureProfile(
      "player-sub",
      "player@example.com",
    );

    expect(login.created).toBe(true);
    expect(login.profile.firstDrop).toBeUndefined();
    expect(send.mock.calls[3]?.[0]?.constructor.name).toBe("PutCommand");
  });

  it("allocates a rollout-gap account exactly once on its next login", async () => {
    const existing = {
      sub: "player-sub",
      playerId: "existing-player",
      email: "player@example.com",
      totalGames: 0,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    send
      .mockRejectedValueOnce(transactionCanceled())
      .mockResolvedValueOnce({ Item: existing })
      .mockResolvedValueOnce({ Item: { claimed: 25 } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...existing, firstDrop: true } });

    const login = await new Repository("test-table").ensureProfile(
      "player-sub",
      "player@example.com",
    );

    expect(login).toMatchObject({
      created: false,
      profile: { firstDrop: true },
    });
    expect(send.mock.calls[3]?.[0]).toBeInstanceOf(TransactWriteCommand);
  });

  it("hands an expired poll session back as nothing", async () => {
    send.mockResolvedValueOnce({
      Item: {
        session: { token: "session-token", expiresAt: "2026-07-18" },
        expiresAt: 1_700_000,
      },
    });

    await expect(
      new Repository("test-table").takePollSession("poll-id", 1_800_000),
    ).resolves.toBeUndefined();
  });

  it("stops a request that has burned its rate-limit budget", async () => {
    send.mockResolvedValueOnce({ Attributes: { requestCount: 6 } });

    await expect(
      new Repository("test-table").useRateLimit("magic-email", "sub", 5, 3_600),
    ).rejects.toMatchObject({ statusCode: 429, code: "rate_limited" });
  });

  it("lets a request inside its budget through", async () => {
    send.mockResolvedValueOnce({ Attributes: { requestCount: 5 } });

    await expect(
      new Repository("test-table").useRateLimit("magic-email", "sub", 5, 3_600),
    ).resolves.toBeUndefined();
  });

  it("keys the referee tag cluster by playerId and never by sub", async () => {
    send
      .mockResolvedValueOnce({ Item: { playerId: "public-player-id" } })
      .mockResolvedValueOnce({ Attributes: { sub: "player-sub" } });

    await new Repository("test-table").updateProfile("player-sub", {
      playerTag: "#ABC123",
    });

    const update = send.mock.calls[1]?.[0].input;
    expect(update.ExpressionAttributeValues[":gsi2sk"]).toBe(
      "#ABC123#public-player-id",
    );
    // The referee reads GSI2; nothing it projects may carry the subject key.
    expect(JSON.stringify(update.ExpressionAttributeValues)).not.toContain(
      "player-sub",
    );
  });

  it("drops the tag and its cluster membership together", async () => {
    send.mockResolvedValueOnce({ Attributes: { sub: "player-sub" } });

    await new Repository("test-table").updateProfile("player-sub", {
      clearPlayerTag: true,
    });

    const update = send.mock.calls[0]?.[0].input;
    expect(update.UpdateExpression).toContain(
      "REMOVE #playerTag, #gsi2pk, #gsi2sk",
    );
  });

  it("skips the cluster keys when the profile has no playerId yet", async () => {
    send
      .mockResolvedValueOnce({ Item: {} })
      .mockResolvedValueOnce({ Attributes: { sub: "player-sub" } });

    await new Repository("test-table").updateProfile("player-sub", {
      playerTag: "#ABC123",
    });

    const update = send.mock.calls[1]?.[0].input;
    expect(update.ExpressionAttributeValues[":gsi2sk"]).toBeUndefined();
    expect(update.UpdateExpression).toContain("#playerTag = :playerTag");
  });

  it("ignores a stale Clash Royale result instead of overwriting fresher data", async () => {
    send.mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").saveCrProfileResult({
        tag: "#ABC123",
        status: "ready",
        refreshRequestedAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:01.000Z",
      }),
    ).resolves.toBe(false);
  });

  it("refuses a Clash Royale result with no request timestamp to match on", async () => {
    await expect(
      new Repository("test-table").saveCrProfileResult({
        tag: "#ABC123",
        status: "ready",
        updatedAt: "2026-07-18T12:00:01.000Z",
      }),
    ).rejects.toThrow("CR profile result is missing its request timestamp");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows an unavailable marker whose claim already resolved", async () => {
    send.mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").markCrRefreshUnavailable(
        "#ABC123",
        "job-1",
        "2026-07-18T12:00:00.000Z",
      ),
    ).resolves.toBeUndefined();
  });

  it("reports a refresh claim lost to a concurrent request", async () => {
    send.mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").claimCrRefresh(
        "#ABC123",
        "job-1",
        "2026-07-18T12:00:00.000Z",
        "2026-07-18T06:00:00.000Z",
        "2026-07-18T11:00:00.000Z",
      ),
    ).resolves.toBe(false);
  });

  it("rejects a war clock save that raced another observation", async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          crSeasonId: 135,
          observedAt: "2026-07-18T12:00:00.000Z",
          seasonStartsAt: "2026-07-01T10:00:00.000Z",
        },
      })
      .mockRejectedValueOnce(conditionFailed());

    await expect(
      new Repository("test-table").saveCrWarClock({
        crSeasonId: 135,
        sectionIndex: 2,
        periodIndex: 10,
        periodType: "warDay",
        seasonStartsAt: "2026-07-01T10:00:00.000Z",
        observedAt: "2026-07-18T13:00:00.000Z",
        sourceClanTag: "#J2RGCRVG",
      }),
    ).resolves.toBe(false);
  });

  it("ignores a public player row that is not a real profile", async () => {
    send.mockResolvedValueOnce({
      Items: [{ pk: "PLAYER#sub", sk: "RUN#2026", playerId: "p-1" }],
    });

    await expect(
      new Repository("test-table").getPublicPlayer("p-1"),
    ).resolves.toBeUndefined();
  });

  it("returns nothing when the pseudonymous id matches no one", async () => {
    send.mockResolvedValueOnce({ Items: [] });

    await expect(
      new Repository("test-table").getPublicPlayer("missing"),
    ).resolves.toBeUndefined();
  });

  it("retries the deletion sweep's unprocessed items", async () => {
    send
      .mockResolvedValueOnce({ Item: { totalGames: 3, playerTag: undefined } })
      .mockResolvedValueOnce({
        Items: [{ pk: "PLAYER#sub", sk: "PROFILE" }],
      })
      .mockResolvedValueOnce({
        UnprocessedItems: {
          "test-table": [
            { DeleteRequest: { Key: { pk: "PLAYER#sub", sk: "PROFILE" } } },
          ],
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await new Repository("test-table").deleteAccount("sub");

    expect(result).toEqual({ deletedGames: 3 });
    // The unprocessed batch was written again before the profile delete.
    expect(send).toHaveBeenCalledTimes(5);
    for (const [command] of send.mock.calls)
      expect(JSON.stringify(command.input)).not.toContain("SYSTEM#FIRST_DROP");
  });

  it("refuses to report a half-finished deletion as done", async () => {
    send
      .mockResolvedValueOnce({ Item: { totalGames: 3 } })
      .mockResolvedValueOnce({ Items: [{ pk: "PLAYER#sub", sk: "PROFILE" }] })
      .mockResolvedValue({
        UnprocessedItems: {
          "test-table": [
            { DeleteRequest: { Key: { pk: "PLAYER#sub", sk: "PROFILE" } } },
          ],
        },
      });

    await expect(
      new Repository("test-table").deleteAccount("sub"),
    ).rejects.toThrow("Player data deletion did not finish");
  });
});
