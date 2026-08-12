import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { client } from "./dynamo.js";
import { HttpError } from "./errors.js";
import {
  isLeaderboardEligibleScore,
  leaderboardPartition,
  leaderboardSortKey,
  modeTiebreakFields,
  tiebreakValues,
} from "./games.js";
import {
  hydrateCrProfiles,
  hydratePublicProfiles,
  placeholderPublicProfile,
} from "./public-profile.js";
import type { GameMode, PublicProfile, RefereeDecision } from "./types.js";

// Every read in this module is reachable from GET /leaderboards, which is
// public and unauthenticated, so each partition walk carries an explicit cap.
// A handful of grinders with thousands of runs must not turn a board read into
// an unbounded scan.
const BOARD_PAGE_SIZE = 200;
// Ten 200-item pages of one player's dense run history is already an extreme
// board.
const MAX_BOARD_PAGES = 10;
const PLAYER_RUN_PAGE_SIZE = 500;
// A player-history walk is the expensive one: the all-time path runs it per
// board row (up to BOARD_PAGE_SIZE of them concurrently), per page, so its
// bound stays well under the board's. Four 500-item pages is the same 2,000-run
// reach the visible-run fallback has always used.
const MAX_PLAYER_RUN_PAGES = 4;
const MAX_PLAYER_RUNS = 2_000;
// BatchGetItem's own per-request key ceiling.
const DECISION_BATCH_SIZE = 100;
// The visible-run fallback resolves decisions in ranked order and stops at the
// first visible run, so the common case is one batch. This caps how deep a
// player's own hidden runs can push that scan.
const MAX_VISIBILITY_BATCHES = 5;

type BoardItem = Record<string, unknown>;

const historyUnavailable = () =>
  new HttpError(
    503,
    "Leaderboard run history is briefly unavailable. Try again.",
    "leaderboard_history_unavailable",
  );

export async function seasonLeaderboard(
  tableName: string,
  mode: GameMode,
  seasonId: string,
  limit = 50,
): Promise<BoardItem[]> {
  const items = await seasonLeaderboardItems(tableName, mode, seasonId, limit);
  return withPublicProfiles(tableName, mode, items);
}

// Internal season-finalization read. It deliberately returns only subjects,
// never hydrated public rows, while reusing the exact referee-aware ranking
// path players see. Keeping this separate prevents an internal subject key
// from leaking into GET /leaderboards.
export async function seasonPodiumFinishers(
  tableName: string,
  mode: GameMode,
  seasonId: string,
): Promise<string[]> {
  return (await seasonLeaderboardItems(tableName, mode, seasonId, 3)).flatMap(
    (item) =>
      typeof item.playerSub === "string" && item.playerSub
        ? [item.playerSub]
        : [],
  );
}

async function seasonLeaderboardItems(
  tableName: string,
  mode: GameMode,
  seasonId: string,
  limit: number,
): Promise<BoardItem[]> {
  const items: BoardItem[] = [];
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
        TableName: tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": leaderboardPartition(seasonId, mode),
        },
        ScanIndexForward: true,
        Limit: BOARD_PAGE_SIZE,
        ExclusiveStartKey: lastKey,
      }),
    );
    pagesRead += 1;
    const pageItems = ((result.Items ?? []) as BoardItem[]).filter((item) =>
      isLeaderboardEligibleScore(Number(item.score)),
    );
    if (pageItems.some((item) => typeof item.runId !== "string"))
      throw historyUnavailable();
    const decisions = await refereeDecisions(tableName, runIdsOf(pageItems));
    for (const item of pageItems) {
      const decision = decisions.get(String(item.runId));
      if (decision?.visibility === "hidden") continue;
      const sub = String(item.playerSub);
      if (!seenPlayers.has(sub)) {
        seenPlayers.add(sub);
        items.push(reviewedItem(item, decision));
        if (items.length >= limit) break;
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (items.length < limit && lastKey && pagesRead < MAX_BOARD_PAGES);

  return items;
}

// Best-ever board: one item per player per ranked mode already lives in the
// partition, so the ordered query maps straight to ranked rows — no dedup.
export async function allTimeLeaderboard(
  tableName: string,
  mode: GameMode,
  limit = 50,
): Promise<BoardItem[]> {
  const items = await allTimeLeaderboardItems(tableName, mode, limit);
  return withPublicProfiles(tableName, mode, items);
}

// Completion-time eligibility check for a strict new all-time leader. It uses
// the same referee-aware fallback as the public board, but returns the raw
// earning run so every mode's ordered tiebreaks remain available.
export async function allTimeLeaderboardLeader(
  tableName: string,
  mode: GameMode,
): Promise<BoardItem | undefined> {
  return (await allTimeLeaderboardItems(tableName, mode, 1))[0];
}

async function allTimeLeaderboardItems(
  tableName: string,
  mode: GameMode,
  limit: number,
): Promise<BoardItem[]> {
  const reconciled: BoardItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  let pagesRead = 0;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": leaderboardPartition("ALLTIME", mode),
        },
        ScanIndexForward: true,
        Limit: BOARD_PAGE_SIZE,
        ExclusiveStartKey: lastKey,
      }),
    );
    const pageItems = await Promise.all(
      ((result.Items ?? []) as BoardItem[])
        .filter((item) => isLeaderboardEligibleScore(Number(item.score)))
        .map((item) => resolveAllTimeEarningRun(tableName, item, mode)),
    );
    const decisions = await refereeDecisions(tableName, runIdsOf(pageItems));
    reconciled.push(
      ...(
        await Promise.all(
          pageItems.map(async (item) => {
            const decision = decisions.get(String(item.runId));
            if (decision?.visibility !== "hidden")
              return reviewedItem(item, decision);
            return bestVisibleRun(
              tableName,
              String(item.playerSub),
              mode,
              String(item.runId),
            );
          }),
        )
      ).filter((item): item is BoardItem => Boolean(item)),
    );
    reconciled.sort((a, b) =>
      leaderboardItemSortKey(a, mode).localeCompare(
        leaderboardItemSortKey(b, mode),
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
      leaderboardItemSortKey(cutoff, mode) <=
        leaderboardItemSortKey(frontier, mode)
    )
      break;
  } while (lastKey && pagesRead < MAX_BOARD_PAGES);

  return reconciled.slice(0, limit);
}

// Best-ever rows scoped to players whose latest stored Clash Royale snapshot
// places them in the requested clan. This walks the ordered all-time
// partition instead of filtering the global top 50: a clanmate ranked 300th
// globally must still be eligible to rank first inside a small clan.
export async function clanAllTimeLeaderboard(
  tableName: string,
  mode: GameMode,
  clanTag: string,
  limit = 50,
): Promise<BoardItem[]> {
  const reconciled: BoardItem[] = [];
  const clanProfiles = new Map<string, PublicProfile>();
  let lastKey: Record<string, unknown> | undefined;
  let pagesRead = 0;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": leaderboardPartition("ALLTIME", mode),
        },
        ScanIndexForward: true,
        Limit: BOARD_PAGE_SIZE,
        ExclusiveStartKey: lastKey,
      }),
    );
    const baseItems = ((result.Items ?? []) as BoardItem[]).filter((item) =>
      isLeaderboardEligibleScore(Number(item.score)),
    );
    const pageProfiles = await hydratePublicProfiles(
      tableName,
      baseItems.map((item) => String(item.playerSub)),
    );
    const crProfiles = await hydrateCrProfiles(
      tableName,
      [...pageProfiles.values()].flatMap((profile) =>
        profile.playerTag ? [profile.playerTag] : [],
      ),
    );
    const clanItems = baseItems.filter((item) => {
      const profile = pageProfiles.get(String(item.playerSub));
      return (
        profile?.playerTag !== undefined &&
        crProfiles.get(profile.playerTag)?.clan?.tag === clanTag
      );
    });
    for (const item of clanItems) {
      const profile = pageProfiles.get(String(item.playerSub));
      if (profile) clanProfiles.set(String(item.playerSub), profile);
    }

    const pageItems = await Promise.all(
      clanItems.map((item) => resolveAllTimeEarningRun(tableName, item, mode)),
    );
    const decisions = await refereeDecisions(tableName, runIdsOf(pageItems));
    reconciled.push(
      ...(
        await Promise.all(
          pageItems.map(async (item) => {
            const decision = decisions.get(String(item.runId));
            if (decision?.visibility !== "hidden")
              return reviewedItem(item, decision);
            return bestVisibleRun(
              tableName,
              String(item.playerSub),
              mode,
              String(item.runId),
            );
          }),
        )
      ).filter((item): item is BoardItem => Boolean(item)),
    );
    reconciled.sort((a, b) =>
      leaderboardItemSortKey(a, mode).localeCompare(
        leaderboardItemSortKey(b, mode),
      ),
    );
    lastKey = result.LastEvaluatedKey;
    pagesRead += 1;

    // The partition is globally ordered. Once the clan's effective cutoff is
    // no worse than the final global row read, no unseen global row can enter
    // this clan's requested top cohort either.
    const cutoff = reconciled[limit - 1];
    const frontier = baseItems.at(-1);
    if (
      cutoff &&
      frontier &&
      leaderboardItemSortKey(cutoff, mode) <=
        leaderboardItemSortKey(frontier, mode)
    )
      break;
  } while (lastKey && pagesRead < MAX_BOARD_PAGES);

  return reconciled
    .slice(0, limit)
    .map((item, index) => toLeaderboardRow(item, mode, index, clanProfiles));
}

function runIdsOf(items: BoardItem[]): string[] {
  return items
    .map((item) => (typeof item.runId === "string" ? item.runId : ""))
    .filter(Boolean);
}

export async function refereeDecisions(
  tableName: string,
  runIds: string[],
): Promise<Map<string, RefereeDecision>> {
  const decisions = new Map<string, RefereeDecision>();
  const uniqueIds = [...new Set(runIds.filter(Boolean))];
  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += DECISION_BATCH_SIZE
  ) {
    let keys: Array<Record<string, unknown>> = uniqueIds
      .slice(offset, offset + DECISION_BATCH_SIZE)
      .map((runId) => ({ pk: `REFEREE#${runId}`, sk: "CURRENT" }));
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const result = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: { Keys: keys, ConsistentRead: true },
          },
        }),
      );
      for (const item of result.Responses?.[tableName] ?? []) {
        const decision = item as RefereeDecision;
        decisions.set(decision.runId, decision);
      }
      keys = (result.UnprocessedKeys?.[tableName]?.Keys ?? []) as Array<
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

function reviewedItem(
  item: BoardItem,
  decision: RefereeDecision | undefined,
): BoardItem {
  return decision?.decidedBy === "fair-play-referee" &&
    decision.visibility === "visible"
    ? { ...item, refereeReviewed: true }
    : item;
}

async function resolveAllTimeEarningRun(
  tableName: string,
  item: BoardItem,
  mode: GameMode,
): Promise<BoardItem> {
  if (typeof item.runId === "string") return item;
  let lastKey: Record<string, unknown> | undefined;
  // Bounded exactly like the board walk above, and for the same reason: this
  // runs once per legacy row on a public, unauthenticated read, so it must
  // never walk a grinder's whole PLAYER# partition. Past the cap the row is
  // reported as briefly unavailable rather than paged for indefinitely.
  let pagesRead = 0;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `PLAYER#${String(item.playerSub)}`,
          ":prefix": "RUN#",
        },
        ExclusiveStartKey: lastKey,
        Limit: PLAYER_RUN_PAGE_SIZE,
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
    pagesRead += 1;
  } while (lastKey && pagesRead < MAX_PLAYER_RUN_PAGES);
  throw historyUnavailable();
}

async function bestVisibleRun(
  tableName: string,
  sub: string,
  mode: GameMode,
  hiddenRunId: string,
): Promise<BoardItem | undefined> {
  const runs: BoardItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  // The run-count cap alone did not bound the walk: it counts only the runs
  // that survive the mode filter, so a player whose history is mostly other
  // modes could still page through the whole partition. Cap the pages too.
  let pagesRead = 0;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `PLAYER#${sub}`,
          ":prefix": "RUN#",
        },
        ExclusiveStartKey: lastKey,
        Limit: PLAYER_RUN_PAGE_SIZE,
      }),
    );
    runs.push(
      ...((result.Items ?? []) as BoardItem[]).filter(
        (item) =>
          item.mode === mode &&
          item.runId !== hiddenRunId &&
          isLeaderboardEligibleScore(Number(item.score)),
      ),
    );
    lastKey = result.LastEvaluatedKey;
    pagesRead += 1;
  } while (
    lastKey &&
    runs.length < MAX_PLAYER_RUNS &&
    pagesRead < MAX_PLAYER_RUN_PAGES
  );

  // Rank first, then resolve referee decisions in rank order and stop at the
  // first visible run. Reading a decision for every candidate meant up to
  // MAX_PLAYER_RUNS / DECISION_BATCH_SIZE BatchGets per hidden row, per board
  // page; the answer only ever depends on the best visible one.
  runs.sort((a, b) =>
    leaderboardItemSortKey(a, mode).localeCompare(
      leaderboardItemSortKey(b, mode),
    ),
  );
  const scanDepth = Math.min(
    runs.length,
    DECISION_BATCH_SIZE * MAX_VISIBILITY_BATCHES,
  );
  for (let offset = 0; offset < scanDepth; offset += DECISION_BATCH_SIZE) {
    const window = runs.slice(offset, offset + DECISION_BATCH_SIZE);
    const decisions = await refereeDecisions(tableName, runIdsOf(window));
    const visible = window.find(
      (item) => decisions.get(String(item.runId))?.visibility !== "hidden",
    );
    if (visible)
      return reviewedItem(visible, decisions.get(String(visible.runId)));
  }
  return undefined;
}

function leaderboardItemSortKey(item: BoardItem, mode: GameMode): string {
  if (typeof item.GSI1SK === "string") return item.GSI1SK;
  return leaderboardSortKey(
    mode,
    Number(item.score),
    String(item.completedAt),
    String(item.playerSub),
    tiebreakValues(mode, item),
  );
}

async function withPublicProfiles(
  tableName: string,
  mode: GameMode,
  items: BoardItem[],
): Promise<BoardItem[]> {
  const profiles = await hydratePublicProfiles(tableName, [
    ...new Set(items.map((item) => String(item.playerSub))),
  ]);
  return items.map((item, index) =>
    toLeaderboardRow(item, mode, index, profiles),
  );
}

// Shared row shape for the season and all-time boards.
function toLeaderboardRow(
  item: BoardItem,
  mode: GameMode,
  index: number,
  profiles: Map<string, PublicProfile>,
): BoardItem {
  // The row shows a time only where time is the board's ONLY tiebreak, so the
  // order the player sees always matches the numbers on the rows. Higher/Lower
  // ranks equal scores by lives lost FIRST, so publishing just its time would
  // render ties in an order the row itself cannot explain.
  const showTime = modeTiebreakFields(mode).length === 1;
  return {
    rank: index + 1,
    score: item.score,
    achievedAt: item.completedAt,
    ...(item.refereeReviewed === true ? { refereeReviewed: true } : {}),
    ...(showTime && item.timeMs !== undefined
      ? { timeMs: item.timeMs as number }
      : {}),
    player:
      profiles.get(String(item.playerSub)) ?? placeholderPublicProfile(index),
  };
}
