import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";
import { leaderboardSortKey } from "./games.js";
import { levelForGames } from "./progression.js";
import type {
  GameMode,
  PlayerProfile,
  PublicProfile,
  RunChallenge,
  RunRecord,
} from "./types.js";

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
}

interface ProfileItem extends PlayerProfile {
  pk: string;
  sk: "PROFILE";
}

function profileKey(sub: string) {
  return { pk: `PLAYER#${sub}`, sk: "PROFILE" as const };
}

function publicProfile(profile: PlayerProfile): PublicProfile {
  const progress = levelForGames(profile.totalGames);
  return {
    id: profile.playerId,
    publicName: profile.publicName || "Elixir Player",
    playerTag: profile.playerTag,
    totalGames: profile.totalGames,
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

  async ensureProfile(sub: string, email: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...profileKey(sub),
            sub,
            playerId: randomUUID(),
            email,
            totalGames: 0,
            createdAt: now,
            updatedAt: now,
          } satisfies ProfileItem,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      ))
        throw error;
    }
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

  async updateProfile(
    sub: string,
    updates: {
      publicName?: string;
      clearPublicName?: boolean;
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
    } else if (updates.clearPublicName) {
      names["#publicName"] = "publicName";
      removes.push("#publicName");
    }
    if (updates.playerTag !== undefined) {
      names["#playerTag"] = "playerTag";
      values[":playerTag"] = updates.playerTag;
      sets.push("#playerTag = :playerTag");
    } else if (updates.clearPlayerTag) {
      names["#playerTag"] = "playerTag";
      removes.push("#playerTag");
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

  async createRun(
    owner: string,
    mode: GameMode,
    challenge: RunChallenge,
    expiresAt: number,
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

  async completeRun(
    run: RunItem,
    score: number,
    seasonId: string,
  ): Promise<{ totalGames?: number; completedAt: string }> {
    const completedAt = new Date().toISOString();
    const historyItem = {
      pk: `PLAYER#${run.owner}`,
      sk: `RUN#${completedAt}#${run.runId}`,
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId,
      completedAt,
      playerSub: run.owner,
      GSI1PK: `LEADERBOARD#${seasonId}#${run.mode}`,
      GSI1SK: leaderboardSortKey(run.mode, score, completedAt, run.owner),
    };
    const authenticated = !run.owner.startsWith("ANON#");
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
          UpdateExpression: `SET updatedAt = :updatedAt ADD totalGames :one${authenticated ? ", authenticatedGames :one" : ""}`,
          ExpressionAttributeValues: { ":one": 1, ":updatedAt": completedAt },
        },
      },
    ];

    if (authenticated) {
      transactionItems.push(
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
            UpdateExpression: "SET updatedAt = :updatedAt ADD totalGames :one",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeValues: { ":one": 1, ":updatedAt": completedAt },
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
        throw new HttpError(
          409,
          "This run was already recorded or is no longer valid.",
          "run_conflict",
        );
      }
      throw error;
    }

    if (!authenticated) return { completedAt };

    const profile = await this.getProfile(run.owner);
    return { totalGames: profile?.totalGames, completedAt };
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

  async leaderboard(
    mode: GameMode,
    seasonId: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    const seenPlayers = new Set<string>();
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: {
            ":pk": `LEADERBOARD#${seasonId}#${mode}`,
          },
          ScanIndexForward: true,
          Limit: 200,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const sub = String(item.playerSub);
        if (!seenPlayers.has(sub)) {
          seenPlayers.add(sub);
          items.push(item);
          if (items.length >= limit) break;
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (items.length < limit && lastKey);

    const subs = [...new Set(items.map((item) => String(item.playerSub)))];
    const profiles = new Map<string, PublicProfile>();
    if (subs.length) {
      const profileResult = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: subs.map((sub) => profileKey(sub)),
              ProjectionExpression:
                "sub, playerId, publicName, playerTag, totalGames",
            },
          },
        }),
      );
      for (const item of profileResult.Responses?.[this.tableName] ?? []) {
        const profile = item as PlayerProfile;
        profiles.set(profile.sub, publicProfile(profile));
      }
    }
    return items.map((item, index) => ({
      rank: index + 1,
      score: item.score,
      achievedAt: item.achievedAt,
      player: profiles.get(String(item.playerSub)) ?? {
        id: `player-${index + 1}`,
        publicName: "Elixir Player",
        totalGames: 0,
        ...levelForGames(0),
      },
    }));
  }

  async globalStats(): Promise<{
    totalGames: number;
    authenticatedGames: number;
  }> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: "GLOBAL", sk: "STATS" },
      }),
    );
    return {
      totalGames: Number(result.Item?.totalGames ?? 0),
      authenticatedGames: Number(result.Item?.authenticatedGames ?? 0),
    };
  }
}
