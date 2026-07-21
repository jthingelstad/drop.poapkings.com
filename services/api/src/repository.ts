import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  type BatchWriteCommandInput,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";
import { leaderboardPartition, leaderboardSortKey } from "./games.js";
import type { CardStatsMap } from "./learning.js";
import { levelForGames } from "./progression.js";
import { TROPHY_ROAD_STARTING_GAMES } from "./trophy-road.js";
import type {
  Correlation,
  EvidenceItem,
  GameMode,
  CrProfileSnapshot,
  PlayerProfile,
  PublicProfile,
  RefereeDecision,
  RunChallenge,
  RunRecord,
  StoredCrWarClock,
} from "./types.js";

type DocumentWriteRequest = NonNullable<
  BatchWriteCommandInput["RequestItems"]
>[string][number];

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

interface MagicItem {
  pk: string;
  sk: "MAGIC";
  email: string;
  expiresAt: number;
  usedAt?: string;
}

export interface RunItem {
  pk: string;
  sk: "RUN";
  runId: string;
  owner: string;
  mode: GameMode;
  challenge: RunChallenge;
  state: "started" | "completed";
  startedAt: string;
  expiresAt: number;
  // Retained for historical runs created by the former personalized-practice
  // path. New runs are always ranked. Absent on older runs means ranked.
  ranked?: boolean;
  // A guest run (no session, owner "guest"): scored on completion but never
  // recorded. Absent/false on ordinary signed-in runs.
  guest?: boolean;
  completedAt?: string;
  score?: number;
  seasonId?: string;
  // Correlation hashes derived from the request at /runs/start. Stored on the
  // ephemeral RUN# row so the completion evidence can compare start vs complete
  // (a mismatch is itself a signal). No raw IP/user-agent is ever kept.
  startCorrelation?: Correlation;
}

interface ProfileItem extends PlayerProfile {
  pk: string;
  sk: "PROFILE";
}

interface CrProfileItem extends CrProfileSnapshot {
  pk: string;
  sk: "PROFILE";
}

interface CrWarClockItem extends StoredCrWarClock {
  pk: "CR_WAR_CLOCK";
  sk: "CURRENT";
}

function profileKey(sub: string) {
  return { pk: `PLAYER#${sub}`, sk: "PROFILE" as const };
}

function crProfileKey(tag: string) {
  return { pk: `CR_PLAYER#${tag}`, sk: "PROFILE" as const };
}

function crWarClockKey() {
  return { pk: "CR_WAR_CLOCK" as const, sk: "CURRENT" as const };
}

function calendarSeasonId(startsAt: string): string {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime()))
    throw new Error("CR war clock has an invalid season start");
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function publicProfile(profile: PlayerProfile): PublicProfile {
  const progress = levelForGames(profile.totalGames);
  return {
    id: profile.playerId,
    publicName: profile.publicName || "Elixir Player",
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    totalGames: profile.totalGames,
    xp: profile.xp ?? 0,
    ...progress,
  };
}

export class Repository {
  constructor(private readonly tableName: string) {}

  async useRateLimit(
    scope: string,
    identity: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
    const result = await client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `RATE#${scope}#${identity}`, sk: String(bucket) },
        UpdateExpression: "SET expiresAt = :expiresAt ADD requestCount :one",
        ExpressionAttributeValues: {
          ":one": 1,
          ":expiresAt": Math.floor(Date.now() / 1_000) + windowSeconds * 2,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    if (Number(result.Attributes?.requestCount ?? 0) > limit) {
      throw new HttpError(
        429,
        "Too many requests. Try again later.",
        "rate_limited",
      );
    }
  }

  async saveMagicLink(
    tokenHash: string,
    email: string,
    expiresAt: number,
  ): Promise<void> {
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `MAGIC#${tokenHash}`,
          sk: "MAGIC",
          email,
          expiresAt,
        } satisfies MagicItem,
      }),
    );
  }

  async deleteMagicLink(tokenHash: string): Promise<void> {
    await client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: `MAGIC#${tokenHash}`, sk: "MAGIC" },
      }),
    );
  }

  // Read-only validity check so redemption can do its durable work (profile
  // creation) before burning the single-use link; a transient failure then
  // leaves the link redeemable instead of eaten by a 500.
  async peekMagicLink(tokenHash: string, nowSeconds: number): Promise<string> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `MAGIC#${tokenHash}`, sk: "MAGIC" },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as MagicItem | undefined;
    if (!item?.email || item.usedAt || item.expiresAt < nowSeconds) {
      throw new HttpError(
        401,
        "This login link is invalid, expired, or already used.",
        "invalid_magic_link",
      );
    }
    return item.email;
  }

  async consumeMagicLink(
    tokenHash: string,
    nowSeconds: number,
  ): Promise<string> {
    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `MAGIC#${tokenHash}`, sk: "MAGIC" },
          UpdateExpression: "SET usedAt = :usedAt",
          ConditionExpression:
            "attribute_exists(pk) AND attribute_not_exists(usedAt) AND expiresAt >= :now",
          ExpressionAttributeValues: {
            ":usedAt": new Date().toISOString(),
            ":now": nowSeconds,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      const item = result.Attributes as MagicItem | undefined;
      if (!item?.email) throw new Error("Magic link record is incomplete");
      return item.email;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      ) {
        throw new HttpError(
          401,
          "This login link is invalid, expired, or already used.",
          "invalid_magic_link",
        );
      }
      throw error;
    }
  }

  async ensureProfile(
    sub: string,
    email: string,
  ): Promise<{ profile: PlayerProfile; created: boolean }> {
    const now = new Date().toISOString();
    const profile: PlayerProfile = {
      sub,
      playerId: randomUUID(),
      email,
      totalGames: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...profileKey(sub),
            ...profile,
          } satisfies ProfileItem,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { profile, created: true };
    } catch (error) {
      if (!(
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      ))
        throw error;
    }
    const existing = await this.getProfile(sub);
    if (!existing) throw new Error("Player profile disappeared during login");
    return { profile: existing, created: false };
  }

  async getProfile(sub: string): Promise<PlayerProfile | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: profileKey(sub),
        ConsistentRead: true,
      }),
    );
    return result.Item as ProfileItem | undefined;
  }

  // The pseudonymous profile UUID for a subject, used to key the tag cluster
  // index without exposing sub. Projects only playerId.
  private async playerIdFor(sub: string): Promise<string | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: profileKey(sub),
        ProjectionExpression: "playerId",
        ConsistentRead: true,
      }),
    );
    return result.Item?.playerId as string | undefined;
  }

  async updateProfile(
    sub: string,
    updates: {
      publicName?: string;
      favoriteCardId?: number;
      playerTag?: string;
      clearPlayerTag?: boolean;
    },
  ): Promise<PlayerProfile> {
    const names: Record<string, string> = { "#updatedAt": "updatedAt" };
    const values: Record<string, unknown> = {
      ":updatedAt": new Date().toISOString(),
    };
    const sets = ["#updatedAt = :updatedAt"];
    const removes: string[] = [];

    if (updates.publicName !== undefined) {
      names["#publicName"] = "publicName";
      values[":publicName"] = updates.publicName;
      sets.push("#publicName = :publicName");
    }
    if (updates.favoriteCardId !== undefined) {
      names["#favoriteCardId"] = "favoriteCardId";
      values[":favoriteCardId"] = updates.favoriteCardId;
      sets.push("#favoriteCardId = :favoriteCardId");
    }
    if (updates.playerTag !== undefined) {
      names["#playerTag"] = "playerTag";
      values[":playerTag"] = updates.playerTag;
      sets.push("#playerTag = :playerTag");
      // Sparse GSI2 tag cluster (single "TAGGED" partition, one row per tagged
      // account). GSI2SK embeds the pseudonymous playerId — NEVER sub — so the
      // read-only referee-tags query never sees an internal subject key. Only
      // PROFILE items carry these keys, and only while a tag is present.
      const playerId = await this.playerIdFor(sub);
      if (playerId) {
        names["#gsi2pk"] = "GSI2PK";
        names["#gsi2sk"] = "GSI2SK";
        values[":gsi2pk"] = "TAGGED";
        values[":gsi2sk"] = `${updates.playerTag}#${playerId}`;
        sets.push("#gsi2pk = :gsi2pk", "#gsi2sk = :gsi2sk");
      }
    } else if (updates.clearPlayerTag) {
      names["#playerTag"] = "playerTag";
      names["#gsi2pk"] = "GSI2PK";
      names["#gsi2sk"] = "GSI2SK";
      // Clearing the tag removes the tag AND its cluster membership.
      removes.push("#playerTag", "#gsi2pk", "#gsi2sk");
    }

    const result = await client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: profileKey(sub),
        UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return result.Attributes as ProfileItem;
  }

  async deleteAccount(sub: string): Promise<{ deletedGames: number }> {
    const existing = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: profileKey(sub),
        ConsistentRead: true,
      }),
    );
    const profile = existing.Item as ProfileItem | undefined;
    const keys = new Map<string, { pk: string; sk: string }>();
    const runIds = new Set<string>();
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": `PLAYER#${sub}` },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const key = { pk: String(item.pk), sk: String(item.sk) };
        keys.set(`${key.pk}\0${key.sk}`, key);
        if (typeof item.runId === "string") {
          runIds.add(item.runId);
          const runKey = { pk: `RUN#${item.runId}`, sk: "RUN" };
          keys.set(`${runKey.pk}\0${runKey.sk}`, runKey);
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Referee decisions deliberately live outside PLAYER# so the referee can
    // write them without authority over player data. Account deletion still
    // promises a complete sweep, so remove current + audit history for every
    // run discovered in the player's partition.
    for (const runId of runIds) {
      let decisionLastKey: Record<string, unknown> | undefined;
      do {
        const result = await client.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": `REFEREE#${runId}` },
            ExclusiveStartKey: decisionLastKey,
          }),
        );
        for (const item of result.Items ?? []) {
          const key = { pk: String(item.pk), sk: String(item.sk) };
          keys.set(`${key.pk}\0${key.sk}`, key);
        }
        decisionLastKey = result.LastEvaluatedKey;
      } while (decisionLastKey);
    }

    const pending: DocumentWriteRequest[] = [...keys.values()].map((Key) => ({
      DeleteRequest: { Key },
    }));
    let unprocessedAttempts = 0;
    while (pending.length) {
      const batch = pending.splice(0, 25);
      const result = await client.send(
        new BatchWriteCommand({
          RequestItems: { [this.tableName]: batch },
        }),
      );
      const unprocessed = result.UnprocessedItems?.[this.tableName] ?? [];
      if (unprocessed.length) {
        unprocessedAttempts += 1;
        if (unprocessedAttempts > 5)
          throw new Error("Player data deletion did not finish");
        pending.unshift(...unprocessed);
        await new Promise((resolve) =>
          setTimeout(resolve, 25 * 2 ** unprocessedAttempts),
        );
      } else {
        unprocessedAttempts = 0;
      }
    }

    // The cached Clash Royale snapshot for the player's tag goes too: the
    // privacy page promises deletion removes CR-derived data, and any other
    // player sharing the tag simply queues a fresh fetch.
    if (profile?.playerTag) {
      await client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: crProfileKey(profile.playerTag),
        }),
      );
    }

    // The profile is deleted last so a mid-sweep failure leaves the account
    // intact and the DELETE retryable, rather than orphaning leaderboard rows
    // behind a 500 with no profile left to authenticate the retry.
    await client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: profileKey(sub),
      }),
    );

    return { deletedGames: profile?.totalGames ?? 0 };
  }

  async getCrProfile(tag: string): Promise<CrProfileSnapshot | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: crProfileKey(tag),
        ConsistentRead: true,
      }),
    );
    return result.Item as CrProfileItem | undefined;
  }

  async claimCrRefresh(
    tag: string,
    jobId: string,
    requestedAt: string,
    staleBefore: string,
    retryBefore: string,
  ): Promise<boolean> {
    try {
      await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: crProfileKey(tag),
          UpdateExpression:
            "SET #tag = :tag, #status = :pending, jobId = :jobId, refreshRequestedAt = :requestedAt, updatedAt = :requestedAt",
          ConditionExpression:
            "(attribute_not_exists(fetchedAt) OR fetchedAt < :staleBefore) AND (attribute_not_exists(refreshRequestedAt) OR refreshRequestedAt < :retryBefore)",
          ExpressionAttributeNames: {
            "#tag": "tag",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":tag": tag,
            ":pending": "pending",
            ":jobId": jobId,
            ":requestedAt": requestedAt,
            ":staleBefore": staleBefore,
            ":retryBefore": retryBefore,
          },
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return false;
      throw error;
    }
  }

  async markCrRefreshUnavailable(
    tag: string,
    jobId: string,
    updatedAt: string,
  ): Promise<void> {
    try {
      await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: crProfileKey(tag),
          UpdateExpression:
            "SET #status = :unavailable, updatedAt = :updatedAt",
          ConditionExpression:
            "jobId = :jobId AND attribute_not_exists(fetchedAt)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":unavailable": "unavailable",
            ":updatedAt": updatedAt,
            ":jobId": jobId,
          },
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return;
      throw error;
    }
  }

  async saveCrProfileResult(snapshot: CrProfileSnapshot): Promise<boolean> {
    if (!snapshot.refreshRequestedAt)
      throw new Error("CR profile result is missing its request timestamp");
    try {
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...crProfileKey(snapshot.tag),
            ...snapshot,
          } satisfies CrProfileItem,
          ConditionExpression:
            "attribute_not_exists(refreshRequestedAt) OR refreshRequestedAt <= :refreshRequestedAt",
          ExpressionAttributeValues: {
            ":refreshRequestedAt": snapshot.refreshRequestedAt,
          },
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return false;
      throw error;
    }
  }

  async getCrWarClock(): Promise<StoredCrWarClock | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: crWarClockKey(),
        ConsistentRead: true,
      }),
    );
    return result.Item as CrWarClockItem | undefined;
  }

  async saveCrWarClock(
    clock: Omit<StoredCrWarClock, "leaderboardSeasonId" | "updatedAt">,
  ): Promise<boolean> {
    const existing = await this.getCrWarClock();
    const calendarId = calendarSeasonId(clock.seasonStartsAt);
    // A new CR season inside a calendar month already using that id gets a
    // crSeasonId-suffixed id. Matching on the prefix (not equality) keeps a
    // third season in one month unique instead of colliding back onto the
    // month's first id.
    const leaderboardSeasonId =
      existing?.crSeasonId === clock.crSeasonId
        ? existing.leaderboardSeasonId
        : existing?.leaderboardSeasonId.startsWith(calendarId)
          ? `${calendarId}-${clock.crSeasonId}`
          : calendarId;
    try {
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...crWarClockKey(),
            ...clock,
            leaderboardSeasonId,
            updatedAt: clock.observedAt,
          } satisfies CrWarClockItem,
          // Guard the read-modify-write id derivation: a concurrent save that
          // changed the CR season since our read fails the condition instead
          // of overwriting its id with one derived from stale state.
          ...(existing
            ? {
                ConditionExpression:
                  "observedAt <= :observedAt AND crSeasonId = :readCrSeasonId",
                ExpressionAttributeValues: {
                  ":observedAt": clock.observedAt,
                  ":readCrSeasonId": existing.crSeasonId,
                },
              }
            : {
                ConditionExpression: "attribute_not_exists(observedAt)",
              }),
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return false;
      throw error;
    }
  }

  async createRun(
    owner: string,
    mode: GameMode,
    challenge: RunChallenge,
    expiresAt: number,
    ranked = true,
    guest = false,
    startCorrelation?: Correlation,
  ): Promise<RunItem> {
    const runId = randomUUID();
    const item: RunItem = {
      pk: `RUN#${runId}`,
      sk: "RUN",
      runId,
      owner,
      mode,
      challenge,
      state: "started",
      startedAt: new Date().toISOString(),
      expiresAt,
      ranked,
      guest,
      ...(startCorrelation ? { startCorrelation } : {}),
    };
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return item;
  }

  // Server-owned learning telemetry lives in the player partition (so account
  // deletion sweeps it) and is written best-effort after completions.
  async getCardStats(sub: string): Promise<CardStatsMap> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `PLAYER#${sub}`, sk: "CARDSTATS" },
      }),
    );
    return (result.Item?.stats ?? {}) as CardStatsMap;
  }

  async saveCardStats(
    sub: string,
    stats: CardStatsMap,
    updatedAt: string,
  ): Promise<void> {
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `PLAYER#${sub}`,
          sk: "CARDSTATS",
          stats,
          updatedAt,
        },
      }),
    );
  }

  async getRun(runId: string): Promise<RunItem | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `RUN#${runId}`, sk: "RUN" },
        ConsistentRead: true,
      }),
    );
    return result.Item as RunItem | undefined;
  }

  // Referee-grade evidence, written best-effort by the caller after a recorded
  // ranked completion (accepted or quarantined) or an unscored signed-in
  // attempt. A plain put (no condition): the evidence sk embeds
  // completedAt+runId, so it is unique, and a failed write must never affect the
  // recorded run. Lives under PLAYER#{sub} so account deletion sweeps it.
  async putRefereeEvidence(item: EvidenceItem): Promise<void> {
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );
  }

  async completeRun(
    run: RunItem,
    score: number,
    seasonId: string,
    xp: number,
    tiebreakMs?: number,
    automaticReviewReason?: string,
  ): Promise<{
    totalGames: number;
    completedAt: string;
    profile: PlayerProfile;
  }> {
    const completedAt = new Date().toISOString();
    const ranked = run.ranked !== false;
    const historyItem = {
      pk: `PLAYER#${run.owner}`,
      sk: `RUN#${completedAt}#${run.runId}`,
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId,
      completedAt,
      playerSub: run.owner,
      // Cumulative time (Survival) rides along for the leaderboard tiebreak and
      // for display.
      ...(tiebreakMs !== undefined ? { timeMs: tiebreakMs } : {}),
      // Historical unranked runs skip the sparse leaderboard index but still
      // count for history, totals, and Trophy Road.
      ...(ranked
        ? {
            GSI1PK: leaderboardPartition(seasonId, run.mode),
            GSI1SK: leaderboardSortKey(
              run.mode,
              score,
              completedAt,
              run.owner,
              tiebreakMs,
            ),
          }
        : {}),
    };
    const transactionItems: NonNullable<
      TransactWriteCommandInput["TransactItems"]
    > = [
      {
        Update: {
          TableName: this.tableName,
          Key: { pk: run.pk, sk: run.sk },
          UpdateExpression:
            "SET #state = :completed, completedAt = :completedAt, score = :score, seasonId = :seasonId",
          ConditionExpression: "#state = :started AND #owner = :owner",
          ExpressionAttributeNames: { "#state": "state", "#owner": "owner" },
          ExpressionAttributeValues: {
            ":completed": "completed",
            ":started": "started",
            ":owner": run.owner,
            ":completedAt": completedAt,
            ":score": score,
            ":seasonId": seasonId,
          },
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: { pk: "GLOBAL", sk: "STATS" },
          UpdateExpression:
            "SET updatedAt = :updatedAt, trophyRoadGames = if_not_exists(trophyRoadGames, :trophyRoadStart) + :one ADD totalGames :one",
          ExpressionAttributeValues: {
            ":one": 1,
            ":trophyRoadStart": TROPHY_ROAD_STARTING_GAMES,
            ":updatedAt": completedAt,
          },
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: historyItem,
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: profileKey(run.owner),
          UpdateExpression:
            "SET updatedAt = :updatedAt ADD totalGames :one, xp :xp",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":one": 1,
            ":xp": xp,
            ":updatedAt": completedAt,
          },
        },
      },
    ];

    // A plausibility failure is a quarantine, not destruction of the run. The
    // visibility decision is committed atomically with the score so a flagged
    // result cannot briefly appear on a public leaderboard. The referee may
    // later replace CURRENT with an audited visible decision; both events stay
    // in immutable DECISION history.
    if (ranked && automaticReviewReason) {
      const evidenceDigest = createHash("sha256")
        .update(
          JSON.stringify({
            runId: run.runId,
            mode: run.mode,
            score,
            startedAt: run.startedAt,
            completedAt,
            reason: automaticReviewReason,
          }),
        )
        .digest("hex");
      const decision = {
        runId: run.runId,
        subjectType: "ranked_run",
        disposition: "review",
        visibility: "hidden",
        reason: automaticReviewReason,
        evidenceDigest,
        decidedAt: completedAt,
        decidedBy: "integrity-gate",
        schemaVersion: "1",
      };
      transactionItems.push(
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk: `REFEREE#${run.runId}`,
              sk: `DECISION#${completedAt}`,
              ...decision,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk: `REFEREE#${run.runId}`,
              sk: "CURRENT",
              ...decision,
            },
          },
        },
      );
    }

    try {
      await client.send(
        new TransactWriteCommand({ TransactItems: transactionItems }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "TransactionCanceledException"
      ) {
        // Only a failed condition means the run truly cannot be recorded.
        // TransactionConflict/throttling is two players completing at the
        // same instant on the shared stats item — retryable, not "already
        // recorded".
        const reasons =
          (error as { CancellationReasons?: Array<{ Code?: string }> })
            .CancellationReasons ?? [];
        const conditionFailed = reasons.some(
          (reason) => reason?.Code === "ConditionalCheckFailed",
        );
        if (conditionFailed)
          throw new HttpError(
            409,
            "This run was already recorded or is no longer valid.",
            "run_conflict",
          );
        throw new HttpError(
          503,
          "Recording is briefly busy. Try again.",
          "run_record_busy",
        );
      }
      throw error;
    }

    const profile = await this.getProfile(run.owner);
    if (!profile) throw new Error("Completed run profile could not be loaded");
    return { totalGames: profile.totalGames, completedAt, profile };
  }

  async listRecentRuns(sub: string, limit = 20): Promise<RunRecord[]> {
    const result = await client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `PLAYER#${sub}`,
          ":prefix": "RUN#",
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []) as RunRecord[];
  }

  // Record one best-ever item per player per ranked mode. Called best-effort
  // AFTER completeRun succeeds (never inside its transaction): a run that is not
  // a new all-time best fails the condition, and that no-op must not roll back
  // the recorded run. Keyed PLAYER#/ALLTIME#mode so there is exactly one row per
  // player per mode (no dedup on read), indexed into the shared leaderboard GSI
  // under the literal "ALLTIME" season id.
  async updateAllTimeBest(
    run: RunItem,
    score: number,
    tiebreakMs: number | undefined,
    completedAt: string,
  ): Promise<void> {
    const newSk = leaderboardSortKey(
      run.mode,
      score,
      completedAt,
      run.owner,
      tiebreakMs,
    );
    const sets = [
      "GSI1PK = :gsi1pk",
      "GSI1SK = :newSk",
      "#mode = :mode",
      "score = :score",
      "completedAt = :completedAt",
      "playerSub = :playerSub",
      // The earning run id, so an all-time board entry resolves to the exact run
      // that produced it (season history rows already carry runId).
      "runId = :runId",
    ];
    const values: Record<string, unknown> = {
      ":gsi1pk": leaderboardPartition("ALLTIME", run.mode),
      ":newSk": newSk,
      ":mode": run.mode,
      ":score": score,
      ":completedAt": completedAt,
      ":playerSub": run.owner,
      ":runId": run.runId,
    };
    // Survival's cumulative time rides along for display and is already folded
    // into the sort key as the streak tiebreak.
    if (tiebreakMs !== undefined) {
      sets.push("timeMs = :timeMs");
      values[":timeMs"] = tiebreakMs;
    }
    try {
      await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `PLAYER#${run.owner}`, sk: `ALLTIME#${run.mode}` },
          UpdateExpression: `SET ${sets.join(", ")}`,
          // A better run produces a lexicographically smaller sort key; only
          // then does it overwrite the stored best. Absent row = first score.
          ConditionExpression:
            "attribute_not_exists(GSI1SK) OR :newSk < GSI1SK",
          ExpressionAttributeNames: { "#mode": "mode" },
          ExpressionAttributeValues: values,
        }),
      );
    } catch (error) {
      // Not a new best is the normal case, not an error — swallow it.
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return;
      throw error;
    }
  }

  async leaderboard(
    mode: GameMode,
    seasonId: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    const seenPlayers = new Set<string>();
    let lastKey: Record<string, unknown> | undefined;
    // Cap the page walk: every completed run adds a GSI row, so a handful of
    // grinders with thousands of runs must not turn the public, unauthenticated
    // leaderboard read into an unbounded scan. Ten 200-item pages of one
    // player's dense run history is already an extreme board.
    let pagesRead = 0;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: {
            ":pk": leaderboardPartition(seasonId, mode),
          },
          ScanIndexForward: true,
          Limit: 200,
          ExclusiveStartKey: lastKey,
        }),
      );
      pagesRead += 1;
      const pageItems = (result.Items ?? []) as Array<Record<string, unknown>>;
      if (pageItems.some((item) => typeof item.runId !== "string"))
        throw new HttpError(
          503,
          "Leaderboard run history is briefly unavailable. Try again.",
          "leaderboard_history_unavailable",
        );
      const decisions = await this.refereeDecisions(
        pageItems
          .map((item) => (typeof item.runId === "string" ? item.runId : ""))
          .filter(Boolean),
      );
      for (const item of pageItems) {
        const decision = decisions.get(String(item.runId));
        if (decision?.visibility === "hidden") continue;
        const sub = String(item.playerSub);
        if (!seenPlayers.has(sub)) {
          seenPlayers.add(sub);
          items.push(item);
          if (items.length >= limit) break;
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (items.length < limit && lastKey && pagesRead < 10);

    const profiles = await this.hydratePublicProfiles([
      ...new Set(items.map((item) => String(item.playerSub))),
    ]);
    return items.map((item, index) =>
      this.toLeaderboardRow(item, index, profiles),
    );
  }

  // Best-ever board: one item per player per ranked mode already lives in the
  // partition, so the ordered query maps straight to ranked rows — no dedup.
  async allTimeLeaderboard(
    mode: GameMode,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const reconciled: Array<Record<string, unknown>> = [];
    let lastKey: Record<string, unknown> | undefined;
    let pagesRead = 0;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: {
            ":pk": leaderboardPartition("ALLTIME", mode),
          },
          ScanIndexForward: true,
          Limit: 200,
          ExclusiveStartKey: lastKey,
        }),
      );
      const pageItems = await Promise.all(
        ((result.Items ?? []) as Array<Record<string, unknown>>).map((item) =>
          this.resolveAllTimeEarningRun(item, mode),
        ),
      );
      const decisions = await this.refereeDecisions(
        pageItems
          .map((item) => (typeof item.runId === "string" ? item.runId : ""))
          .filter(Boolean),
      );
      reconciled.push(
        ...(
          await Promise.all(
            pageItems.map(async (item) => {
              const decision = decisions.get(String(item.runId));
              if (decision?.visibility !== "hidden") return item;
              return this.bestVisibleRun(
                String(item.playerSub),
                mode,
                String(item.runId),
              );
            }),
          )
        ).filter((item): item is Record<string, unknown> => Boolean(item)),
      );
      reconciled.sort((a, b) =>
        this.leaderboardItemSortKey(a, mode).localeCompare(
          this.leaderboardItemSortKey(b, mode),
        ),
      );
      lastKey = result.LastEvaluatedKey;
      pagesRead += 1;
      // Base all-time rows are ordered. A hidden row can only fall backward to
      // a worse score, so once the effective cutoff is no worse than the last
      // base row read, no unseen player can enter the requested top cohort.
      const cutoff = reconciled[limit - 1];
      const frontier = pageItems.at(-1);
      if (
        cutoff &&
        frontier &&
        this.leaderboardItemSortKey(cutoff, mode) <=
          this.leaderboardItemSortKey(frontier, mode)
      )
        break;
    } while (lastKey && pagesRead < 10);

    const items = reconciled.slice(0, limit);
    const profiles = await this.hydratePublicProfiles([
      ...new Set(items.map((item) => String(item.playerSub))),
    ]);
    return items.map((item, index) =>
      this.toLeaderboardRow(item, index, profiles),
    );
  }

  private async refereeDecisions(
    runIds: string[],
  ): Promise<Map<string, RefereeDecision>> {
    const decisions = new Map<string, RefereeDecision>();
    const uniqueIds = [...new Set(runIds.filter(Boolean))];
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      let keys: Array<Record<string, unknown>> = uniqueIds
        .slice(offset, offset + 100)
        .map((runId) => ({ pk: `REFEREE#${runId}`, sk: "CURRENT" }));
      for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
        if (attempt > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * 2 ** attempt),
          );
        const result = await client.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tableName]: { Keys: keys, ConsistentRead: true },
            },
          }),
        );
        for (const item of result.Responses?.[this.tableName] ?? []) {
          const decision = item as RefereeDecision;
          decisions.set(decision.runId, decision);
        }
        keys = (result.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as Array<
          Record<string, unknown>
        >;
      }
      if (keys.length)
        throw new HttpError(
          503,
          "Leaderboard review status is briefly unavailable. Try again.",
          "leaderboard_review_unavailable",
        );
    }
    return decisions;
  }

  private async resolveAllTimeEarningRun(
    item: Record<string, unknown>,
    mode: GameMode,
  ): Promise<Record<string, unknown>> {
    if (typeof item.runId === "string") return item;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": `PLAYER#${String(item.playerSub)}`,
            ":prefix": "RUN#",
          },
          ExclusiveStartKey: lastKey,
          Limit: 500,
        }),
      );
      const match = (result.Items ?? []).find(
        (run) =>
          run.mode === mode &&
          run.score === item.score &&
          run.completedAt === item.completedAt &&
          (item.timeMs === undefined || run.timeMs === item.timeMs),
      );
      if (typeof match?.runId === "string")
        return { ...item, runId: match.runId };
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    throw new HttpError(
      503,
      "Leaderboard run history is briefly unavailable. Try again.",
      "leaderboard_history_unavailable",
    );
  }

  private async bestVisibleRun(
    sub: string,
    mode: GameMode,
    hiddenRunId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const runs: Array<Record<string, unknown>> = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": `PLAYER#${sub}`,
            ":prefix": "RUN#",
          },
          ExclusiveStartKey: lastKey,
          Limit: 500,
        }),
      );
      runs.push(
        ...((result.Items ?? []) as Array<Record<string, unknown>>).filter(
          (item) => item.mode === mode && item.runId !== hiddenRunId,
        ),
      );
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && runs.length < 2_000);

    const decisions = await this.refereeDecisions(
      runs
        .map((item) => (typeof item.runId === "string" ? item.runId : ""))
        .filter(Boolean),
    );
    return runs
      .filter(
        (item) => decisions.get(String(item.runId))?.visibility !== "hidden",
      )
      .sort((a, b) =>
        this.leaderboardItemSortKey(a, mode).localeCompare(
          this.leaderboardItemSortKey(b, mode),
        ),
      )[0];
  }

  private leaderboardItemSortKey(
    item: Record<string, unknown>,
    mode: GameMode,
  ): string {
    if (typeof item.GSI1SK === "string") return item.GSI1SK;
    return leaderboardSortKey(
      mode,
      Number(item.score),
      String(item.completedAt),
      String(item.playerSub),
      item.timeMs === undefined ? undefined : Number(item.timeMs),
    );
  }

  // Shared public-profile hydration for the season and all-time boards.
  private async hydratePublicProfiles(
    subs: string[],
  ): Promise<Map<string, PublicProfile>> {
    const profiles = new Map<string, PublicProfile>();
    if (!subs.length) return profiles;
    // BatchGet is allowed to return unprocessed keys under throttling; without
    // the retry, real players render as the placeholder profile.
    let keys: Array<Record<string, unknown>> = subs.map((sub) =>
      profileKey(sub),
    );
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const profileResult = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: keys,
              ProjectionExpression:
                "#sub, playerId, publicName, favoriteCardId, playerTag, totalGames, xp",
              ExpressionAttributeNames: {
                "#sub": "sub",
              },
            },
          },
        }),
      );
      for (const item of profileResult.Responses?.[this.tableName] ?? []) {
        const profile = item as PlayerProfile;
        profiles.set(profile.sub, publicProfile(profile));
      }
      keys = (profileResult.UnprocessedKeys?.[this.tableName]?.Keys ??
        []) as Array<Record<string, unknown>>;
    }
    return profiles;
  }

  // Shared row shape for the season and all-time boards.
  private toLeaderboardRow(
    item: Record<string, unknown>,
    index: number,
    profiles: Map<string, PublicProfile>,
  ): Record<string, unknown> {
    return {
      rank: index + 1,
      score: item.score,
      achievedAt: item.completedAt,
      ...(item.timeMs !== undefined ? { timeMs: item.timeMs as number } : {}),
      player: profiles.get(String(item.playerSub)) ?? {
        id: `player-${index + 1}`,
        publicName: "Elixir Player",
        totalGames: 0,
        xp: 0,
        ...levelForGames(0),
      },
    };
  }

  async globalStats(): Promise<{
    trophyRoadGames: number;
  }> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: "GLOBAL", sk: "STATS" },
      }),
    );
    return {
      trophyRoadGames: Number(
        result.Item?.trophyRoadGames ?? TROPHY_ROAD_STARTING_GAMES,
      ),
    };
  }
}
