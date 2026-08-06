import {
  BatchWriteCommand,
  type BatchWriteCommandInput,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import type { BadgeCounters } from "./badges.js";
import { client, profileKey } from "./dynamo.js";
import { HttpError } from "./errors.js";
import {
  boardEpochFor,
  isGameMode,
  isCurrentBoardRun,
  isLeaderboardEligibleScore,
  leaderboardPartition,
  leaderboardSortKey,
  MODE_RULES,
  tiebreakAttributes,
  tiebreakValues,
} from "./games.js";
import { allTimeLeaderboard, seasonLeaderboard } from "./leaderboards.js";
import { seasonPodiumFinishers } from "./leaderboards.js";
import type { CardStatsMap } from "./learning.js";
import {
  hydratePublicProfiles,
  placeholderPublicProfile,
  publicProfile,
} from "./public-profile.js";
import { TROPHY_ROAD_STARTING_GAMES } from "./trophy-road.js";
import type {
  Correlation,
  EvidenceItem,
  GameMode,
  CrProfileSnapshot,
  PlayerProfile,
  PublicProfile,
  RunChallenge,
  RunRecord,
  RunTiebreaks,
  StoredCrWarClock,
} from "./types.js";

type DocumentWriteRequest = NonNullable<
  BatchWriteCommandInput["RequestItems"]
>[string][number];

// Recent-run feed rows are ephemeral — they expire two days after the run.
const FEED_TTL_SECONDS = 2 * 24 * 60 * 60;
export const ACTIVITY_WINDOW_HOURS = 24;
const ACTIVITY_WINDOW_MS = ACTIVITY_WINDOW_HOURS * 60 * 60 * 1_000;
const ACTIVITY_QUERY_PAGE_SIZE = 100;
const ACTIVITY_SCAN_LIMIT = 500;
const MAX_ACTIVITY_GROUPS_PER_PLAYER = 2;

interface ActivityGroup {
  playerSub: string;
  mode: GameMode;
  score: number;
  achievedAt: string;
  runCount: number;
  timeMs?: number;
}

interface MagicItem {
  pk: string;
  sk: "MAGIC";
  email: string;
  expiresAt: number;
  usedAt?: string;
  // The secret poll id (known only to the requesting client) so a PWA that can't
  // receive the emailed link's browser context can still pick up its session.
  pollId?: string;
}

interface SessionEnvelope {
  token: string;
  expiresAt: string;
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
  // Validated answers folded into this completion. It is added to the in-memory
  // run at completion time and copied to history; the started RUN# item never
  // trusts or stores a client-reported aggregate.
  answerCount?: number;
  completedAt?: string;
  score?: number;
  seasonId?: string;
  // The mode definition that dealt this challenge. Stored at start rather than
  // inferred at completion so an in-flight run cannot cross a deploy boundary.
  boardEpoch?: string;
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

export interface StoredBadgeCounters extends BadgeCounters {
  updatedAt?: string;
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

export interface PublicPlayerLookup {
  // The subject key is retained inside the repository boundary only so callers
  // can load the player's run history. It is never part of a public response.
  sub: string;
  player: PublicProfile;
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
    pollId?: string,
  ): Promise<void> {
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `MAGIC#${tokenHash}`,
          sk: "MAGIC",
          email,
          expiresAt,
          ...(pollId ? { pollId } : {}),
        } satisfies MagicItem,
      }),
    );
  }

  // Cross-context login handoff. When a magic link is redeemed (possibly in a
  // different browser than the one that requested it — e.g. Safari opening the
  // link while the player waits in the installed PWA), the redeem writes the new
  // session here keyed by the request's secret poll id; the waiting client polls
  // for it. TTL'd like the link itself.
  async savePollSession(
    pollId: string,
    session: SessionEnvelope,
    expiresAt: number,
  ): Promise<void> {
    await client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `POLL#${pollId}`, sk: "POLL", session, expiresAt },
      }),
    );
  }

  async takePollSession(
    pollId: string,
    nowSeconds: number,
  ): Promise<SessionEnvelope | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `POLL#${pollId}`, sk: "POLL" },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as
      { session?: SessionEnvelope; expiresAt?: number } | undefined;
    if (!item?.session || (item.expiresAt ?? 0) < nowSeconds) return undefined;
    return item.session;
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
  async peekMagicLink(
    tokenHash: string,
    nowSeconds: number,
  ): Promise<{ email: string; pollId?: string }> {
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
    return { email: item.email, pollId: item.pollId };
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

  async getPublicPlayer(
    playerId: string,
  ): Promise<PublicPlayerLookup | undefined> {
    const result = await client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI3",
        KeyConditionExpression: "playerId = :playerId",
        ExpressionAttributeValues: { ":playerId": playerId },
        Limit: 1,
      }),
    );
    const item = result.Items?.[0] as Partial<ProfileItem> | undefined;
    if (
      !item ||
      item.sk !== "PROFILE" ||
      typeof item.pk !== "string" ||
      !item.pk.startsWith("PLAYER#") ||
      typeof item.playerId !== "string" ||
      typeof item.totalGames !== "number"
    ) {
      return undefined;
    }
    const sub = item.pk.slice("PLAYER#".length);
    if (!sub) return undefined;
    return {
      sub,
      player: publicProfile({
        playerId: item.playerId,
        publicName: item.publicName,
        favoriteCardId: item.favoriteCardId,
        playerTag: item.playerTag,
        totalGames: item.totalGames,
        xp: item.xp,
      }),
    };
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
    const boardEpoch = boardEpochFor(mode);
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
      ...(boardEpoch ? { boardEpoch } : {}),
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
        ConsistentRead: true,
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

  // Badge counters live beside the learning stats in the player partition, so
  // account deletion sweeps them with everything else, and are written
  // best-effort after completions. One item per player: the whole ladder set is
  // derived from these counters, so there is nothing per-badge to store.
  async getBadges(sub: string): Promise<StoredBadgeCounters | undefined> {
    const result = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `PLAYER#${sub}`, sk: "BADGES" },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (!item || typeof item.version !== "number") return undefined;
    return {
      version: item.version,
      values: (item.values ?? {}) as Record<string, number>,
      runsAtRung: (item.runsAtRung ?? {}) as Record<string, number[]>,
      aux: (item.aux ?? {
        modes: [],
        cards: [],
        dayStreak: 0,
        dayRuns: 0,
      }) as BadgeCounters["aux"],
      earned: (item.earned ?? {}) as Record<string, string[]>,
      ...(typeof item.updatedAt === "string"
        ? { updatedAt: item.updatedAt }
        : {}),
    };
  }

  async saveBadges(
    sub: string,
    counters: BadgeCounters,
    updatedAt: string,
    expected?: { version: number; updatedAt?: string },
  ): Promise<boolean> {
    try {
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `PLAYER#${sub}`,
            sk: "BADGES",
            version: counters.version,
            values: counters.values,
            runsAtRung: counters.runsAtRung,
            aux: counters.aux,
            earned: counters.earned,
            updatedAt,
          },
          ConditionExpression: expected
            ? expected.updatedAt
              ? "#version = :expectedVersion AND updatedAt = :expectedUpdatedAt"
              : "#version = :expectedVersion AND attribute_not_exists(updatedAt)"
            : "attribute_not_exists(pk)",
          ...(expected
            ? {
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: {
                  ":expectedVersion": expected.version,
                  ...(expected.updatedAt
                    ? { ":expectedUpdatedAt": expected.updatedAt }
                    : {}),
                },
              }
            : {}),
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

  // Atomically records one mode's podium finish and replaces the player's
  // badge bag. The marker makes SQS redelivery and partial season retries a
  // no-op; the badge condition prevents a concurrent run completion from being
  // overwritten by the season job.
  async savePodiumAward(
    sub: string,
    seasonId: string,
    mode: GameMode,
    counters: BadgeCounters,
    awardedAt: string,
    updatedAt: string,
    expected?: { version: number; updatedAt?: string },
  ): Promise<boolean> {
    const badgeCondition = expected
      ? expected.updatedAt
        ? "#version = :expectedVersion AND updatedAt = :expectedUpdatedAt"
        : "#version = :expectedVersion AND attribute_not_exists(updatedAt)"
      : "attribute_not_exists(pk)";
    try {
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `PLAYER#${sub}`,
                  sk: `PODIUM#${seasonId}#${mode}`,
                  seasonId,
                  mode,
                  awardedAt,
                  processedAt: updatedAt,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `PLAYER#${sub}`,
                  sk: "BADGES",
                  version: counters.version,
                  values: counters.values,
                  runsAtRung: counters.runsAtRung,
                  aux: counters.aux,
                  earned: counters.earned,
                  updatedAt,
                },
                ConditionExpression: badgeCondition,
                ...(expected
                  ? {
                      ExpressionAttributeNames: { "#version": "version" },
                      ExpressionAttributeValues: {
                        ":expectedVersion": expected.version,
                        ...(expected.updatedAt
                          ? { ":expectedUpdatedAt": expected.updatedAt }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if (!(
        error instanceof Error && error.name === "TransactionCanceledException"
      ))
        throw error;
      const marker = await client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `PLAYER#${sub}`,
            sk: `PODIUM#${seasonId}#${mode}`,
          },
          ConsistentRead: true,
        }),
      );
      if (marker.Item) return false;
      throw error;
    }
  }

  // Every recorded run for one player, newest first. This is the authoritative
  // history behind the profile's season drill-down; unlike listRecentRuns it
  // walks every page, so a busy player's season never flattens to the feed's
  // 20-row cap.
  async listRunHistory(sub: string): Promise<
    Array<{
      runId: string;
      mode: string;
      score: number;
      seasonId: string;
      completedAt: string;
      answerCount?: number;
      boardEpoch?: string;
    }>
  > {
    const runs: Array<{
      runId: string;
      mode: string;
      score: number;
      seasonId: string;
      completedAt: string;
      answerCount?: number;
      boardEpoch?: string;
    }> = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": `PLAYER#${sub}`,
            ":sk": "RUN#",
          },
          ProjectionExpression:
            "runId, #mode, score, seasonId, completedAt, answerCount, boardEpoch",
          ExpressionAttributeNames: { "#mode": "mode" },
          ScanIndexForward: false,
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        if (
          typeof item.runId === "string" &&
          typeof item.mode === "string" &&
          typeof item.score === "number" &&
          typeof item.seasonId === "string" &&
          typeof item.completedAt === "string"
        ) {
          runs.push({
            runId: item.runId,
            mode: item.mode,
            score: item.score,
            seasonId: item.seasonId,
            completedAt: item.completedAt,
            ...(typeof item.answerCount === "number"
              ? { answerCount: item.answerCount }
              : {}),
            ...(typeof item.boardEpoch === "string"
              ? { boardEpoch: item.boardEpoch }
              : {}),
          });
        }
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return runs;
  }

  // Every recorded run for one player — the input to a badge backfill.
  // listRecentRuns caps at 20 for the profile feed; this deliberately walks
  // the whole RUN# range instead, because a partial history would compute
  // wrong counters and then store them as if they were complete.
  async listAllRuns(sub: string): Promise<
    Array<{
      mode: string;
      score: number;
      completedAt: string;
      answerCount?: number;
      runId: string;
      boardEpoch?: string;
    }>
  > {
    return (await this.listRunHistory(sub)).map(
      ({ runId, mode, score, completedAt, answerCount, boardEpoch }) => ({
        runId,
        mode,
        score,
        completedAt,
        ...(answerCount !== undefined ? { answerCount } : {}),
        ...(boardEpoch !== undefined ? { boardEpoch } : {}),
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
    tiebreaks?: RunTiebreaks,
    automaticReviewReason?: string,
  ): Promise<{
    totalGames: number;
    completedAt: string;
    profile: PlayerProfile;
  }> {
    const completedAt = new Date().toISOString();
    const ranked = run.ranked !== false;
    const leaderboardEligible = ranked && isLeaderboardEligibleScore(score);
    // The mode's tiebreak values (Survival's cumulative time; Higher/Lower's
    // lives lost then time) ride along on the row for display and for the
    // GSI1SK fallback — the key below is built from the very attributes stored,
    // so the two can never disagree.
    const tiebreakItem = tiebreakAttributes(run.mode, tiebreaks);
    const historyItem = {
      pk: `PLAYER#${run.owner}`,
      sk: `RUN#${completedAt}#${run.runId}`,
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId,
      completedAt,
      playerSub: run.owner,
      ...(run.boardEpoch ? { boardEpoch: run.boardEpoch } : {}),
      ...(run.answerCount !== undefined
        ? { answerCount: run.answerCount }
        : {}),
      ...tiebreakItem,
      // Historical unranked runs skip the sparse leaderboard index but still
      // count for history, totals, and Trophy Road.
      ...(leaderboardEligible
        ? {
            // Keep a run on the board definition that dealt it. This matters
            // during an epoch deploy: an already-open retired run may finish
            // after the new board becomes current, but it must stay orphaned.
            GSI1PK: leaderboardPartition(seasonId, run.mode, run.boardEpoch),
            GSI1SK: leaderboardSortKey(
              run.mode,
              score,
              completedAt,
              run.owner,
              tiebreakValues(run.mode, tiebreakItem),
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

    // Recent-activity feed: one ephemeral (TTL'd) row per accepted
    // ranked run, keyed newest-first in the main table (pk = FEED#{season}, sk =
    // ISO ts). Quarantined runs (automaticReviewReason set → hidden) never hit the
    // public feed. The history Put's idempotency condition makes the whole
    // transaction — feed row included — safe to replay. Name/card resolve on read.
    if (ranked && !automaticReviewReason) {
      transactionItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: `FEED#${seasonId}`,
            sk: `${completedAt}#${run.runId}`,
            playerSub: run.owner,
            mode: run.mode,
            score,
            completedAt,
            ...tiebreakItem,
            expiresAt: Math.floor(Date.now() / 1_000) + FEED_TTL_SECONDS,
          },
        },
      });
    }

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

  // Recent runs — collapse the last 24 hours by player + mode before applying
  // the visible limit. This keeps one enthusiastic player from filling the rail
  // while still letting distinct games tell separate stories. Raw feed rows
  // remain immutable and TTL'd; this is a read-only display projection.
  async recentActivity(
    seasonId: string,
    limit = 8,
  ): Promise<Array<Record<string, unknown>>> {
    const visibleLimit = Math.max(1, Math.min(limit, 25));
    const since = new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString();
    const items: Array<Record<string, unknown>> = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND sk >= :since",
          ExpressionAttributeValues: {
            ":pk": `FEED#${seasonId}`,
            ":since": since,
          },
          ScanIndexForward: false,
          Limit: Math.min(
            ACTIVITY_QUERY_PAGE_SIZE,
            ACTIVITY_SCAN_LIMIT - items.length,
          ),
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      const remaining = ACTIVITY_SCAN_LIMIT - items.length;
      items.push(
        ...((result.Items ?? []) as Array<Record<string, unknown>>).slice(
          0,
          remaining,
        ),
      );
      cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor && items.length < ACTIVITY_SCAN_LIMIT);

    const grouped = new Map<string, ActivityGroup>();
    for (const item of items) {
      if (
        typeof item.playerSub !== "string" ||
        !isGameMode(item.mode) ||
        typeof item.completedAt !== "string" ||
        typeof item.score !== "number" ||
        !Number.isFinite(item.score)
      )
        continue;

      const key = `${item.playerSub}\u0000${item.mode}`;
      const existing = grouped.get(key);
      const candidateTimeMs =
        typeof item.timeMs === "number" && Number.isFinite(item.timeMs)
          ? item.timeMs
          : undefined;
      if (!existing) {
        grouped.set(key, {
          playerSub: item.playerSub,
          mode: item.mode,
          score: item.score,
          achievedAt: item.completedAt,
          runCount: 1,
          ...(candidateTimeMs !== undefined ? { timeMs: candidateTimeMs } : {}),
        });
        continue;
      }

      existing.runCount += 1;
      if (item.completedAt > existing.achievedAt)
        existing.achievedAt = item.completedAt;
      const isBetter =
        MODE_RULES[item.mode].direction === "lower"
          ? item.score < existing.score
          : item.score > existing.score;
      if (isBetter) {
        existing.score = item.score;
        if (candidateTimeMs === undefined) delete existing.timeMs;
        else existing.timeMs = candidateTimeMs;
      }
    }

    const perPlayer = new Map<string, number>();
    const groups = [...grouped.values()]
      .sort((left, right) => right.achievedAt.localeCompare(left.achievedAt))
      .filter((group) => {
        const count = perPlayer.get(group.playerSub) ?? 0;
        if (count >= MAX_ACTIVITY_GROUPS_PER_PLAYER) return false;
        perPlayer.set(group.playerSub, count + 1);
        return true;
      })
      .slice(0, visibleLimit);

    const profiles = await hydratePublicProfiles(this.tableName, [
      ...new Set(groups.map((group) => group.playerSub)),
    ]);
    return groups.map((group, index) => ({
      mode: group.mode,
      score: group.score,
      achievedAt: group.achievedAt,
      runCount: group.runCount,
      ...(group.timeMs !== undefined ? { timeMs: group.timeMs } : {}),
      player: profiles.get(group.playerSub) ?? placeholderPublicProfile(index),
    }));
  }

  // Record one best-ever item per player per ranked mode. Called best-effort
  // AFTER completeRun succeeds (never inside its transaction): a run that is not
  // a new all-time best fails the condition, and that no-op must not roll back
  // the recorded run. Keyed PLAYER#/ALLTIME#mode so there is exactly one row per
  // player per mode (no dedup on read), indexed into the shared leaderboard GSI
  // under the literal "ALLTIME" season id.
  //
  // Returns whether this run became the new best and what it displaced, because
  // two hidden badges (Photo Finish, Cold Open) turn on exactly that — and this
  // conditional write is the only place that already knows it.
  async updateAllTimeBest(
    run: RunItem,
    score: number,
    tiebreaks: RunTiebreaks | undefined,
    completedAt: string,
  ): Promise<{ improved: boolean; previousScore?: number }> {
    if (
      !isLeaderboardEligibleScore(score) ||
      !isCurrentBoardRun({
        mode: run.mode,
        boardEpoch: run.boardEpoch,
        completedAt,
      })
    )
      return { improved: false };
    const tiebreakItem = tiebreakAttributes(run.mode, tiebreaks);
    const currentPartition = leaderboardPartition("ALLTIME", run.mode);
    const newSk = leaderboardSortKey(
      run.mode,
      score,
      completedAt,
      run.owner,
      tiebreakValues(run.mode, tiebreakItem),
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
      ":gsi1pk": currentPartition,
      ":newSk": newSk,
      ":mode": run.mode,
      ":score": score,
      ":completedAt": completedAt,
      ":playerSub": run.owner,
      ":runId": run.runId,
    };
    const boardEpoch = boardEpochFor(run.mode);
    if (boardEpoch) {
      sets.push("boardEpoch = :boardEpoch");
      values[":boardEpoch"] = boardEpoch;
    }
    // The mode's tiebreak values ride along for display and are already folded
    // into the sort key above.
    for (const [field, value] of Object.entries(tiebreakItem)) {
      sets.push(`${field} = :${field}`);
      values[`:${field}`] = value;
    }
    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `PLAYER#${run.owner}`, sk: `ALLTIME#${run.mode}` },
          UpdateExpression: `SET ${sets.join(", ")}`,
          // A retired board's projection may contain a numerically "better"
          // but incomparable score. Crossing partitions resets the comparison;
          // within the current partition only a genuinely better key wins.
          ConditionExpression:
            "attribute_not_exists(GSI1SK) OR GSI1PK <> :gsi1pk OR :newSk < GSI1SK",
          ExpressionAttributeNames: { "#mode": "mode" },
          ExpressionAttributeValues: values,
          // The displaced row, so the caller can measure the improvement.
          ReturnValues: "ALL_OLD",
        }),
      );
      const previous =
        result.Attributes?.GSI1PK === currentPartition
          ? result.Attributes.score
          : undefined;
      return {
        improved: true,
        ...(typeof previous === "number" ? { previousScore: previous } : {}),
      };
    } catch (error) {
      // Not a new best is the normal case, not an error — swallow it.
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return { improved: false };
      throw error;
    }
  }

  // The board read path (season + all-time reconciliation, referee
  // visibility, profile hydration) lives in leaderboards.ts; these stay here
  // so callers keep one repository surface.
  async leaderboard(
    mode: GameMode,
    seasonId: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    return seasonLeaderboard(this.tableName, mode, seasonId, limit);
  }

  async podiumFinishers(mode: GameMode, seasonId: string): Promise<string[]> {
    return seasonPodiumFinishers(this.tableName, mode, seasonId);
  }

  async allTimeLeaderboard(
    mode: GameMode,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    return allTimeLeaderboard(this.tableName, mode, limit);
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
