// Shared conventions + helpers for the bounded Fair Play Referee scripts.
//
// These scripts are a documented, sanitized evidence and decision surface over
// the Drop game table. They import NOTHING from services/api
// (workspace-boundary rule); key conventions are duplicated here on purpose.
//
// Hard rules (enforced by sanitize + the callers):
//   * Never print `sub`, email, a raw IP, a raw user-agent, or the pepper.
//   * The referee sees only the pseudonymous `playerId`, opaque correlation
//     hashes, and the normalized (unverified) player tag.
//   * Fail closed: on missing creds / not found / incomplete evidence, print a
//     `{ "status": "insufficient_evidence", ... }` object and exit non-zero.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";

// The live ranked modes. Practice is unranked and guest runs are never
// recorded, so neither has a leaderboard partition.
export const RANKED_MODES = ["surge", "higher-lower", "trade", "survival"];

// Mirror of services/api/src/games.ts BOARD_EPOCH: Survival's board was reset
// to "r2" when it became a clear-the-deck, time-ranked game.
const BOARD_EPOCH = { survival: "r2" };

export function leaderboardPartition(seasonId, mode) {
  const epoch = BOARD_EPOCH[mode];
  return epoch
    ? `LEADERBOARD#${seasonId}#${mode}#${epoch}`
    : `LEADERBOARD#${seasonId}#${mode}`;
}

// Sensitive attributes that must never leave these scripts.
const FORBIDDEN_KEYS = new Set(["sub", "playerSub", "email", "pk"]);

let cachedDoc;

// A DynamoDB document client using the ambient AWS credential chain (the host
// is expected to have assumed the bounded RefereeReadRole). Fails closed if no
// region is configured.
export function client() {
  if (cachedDoc) return cachedDoc;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region)
    failClosed("no_aws_region", "Set AWS_REGION for the referee host");
  cachedDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cachedDoc;
}

export function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Print the fail-closed envelope and exit non-zero. `insufficient_evidence` is
// the referee's contract for "I could not responsibly review this".
export function failClosed(reason, detail) {
  print({
    status: "insufficient_evidence",
    reason,
    ...(detail ? { detail } : {}),
  });
  process.exit(1);
}

const playerIdCache = new Map();

// Map an internal subject key to the pseudonymous playerId via the profile.
// Returns undefined if the profile is gone (deleted account).
export async function playerIdForSub(doc, sub) {
  if (playerIdCache.has(sub)) return playerIdCache.get(sub);
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `PLAYER#${sub}`, sk: "PROFILE" },
      ProjectionExpression: "playerId",
    }),
  );
  const playerId = result.Item?.playerId;
  playerIdCache.set(sub, playerId);
  return playerId;
}

// Reverse map: find the subject key that owns a given pseudonymous playerId.
// Profiles are the only PROFILE items carrying playerId, so a filtered scan
// resolves it (bounded at beta scale). Never emit the sub it returns.
export async function subForPlayerId(doc, playerId) {
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "sk = :profile AND playerId = :playerId",
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":playerId": playerId,
        },
        ProjectionExpression: "pk, playerId",
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if (typeof item.pk === "string" && item.pk.startsWith("PLAYER#")) {
        return item.pk.slice("PLAYER#".length);
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return undefined;
}

// Strip forbidden identifiers from an item and stamp the pseudonymous playerId
// in their place. Deep-cleans nested objects/arrays so no `sub`/email hides in a
// nested field. Correlation hashes and the normalized tag are opaque and remain.
export function sanitize(item, playerId) {
  const cleaned = stripForbidden(item);
  return { playerId, ...cleaned };
}

export function sanitizeRecord(item) {
  return stripForbidden(item);
}

function stripForbidden(value) {
  if (Array.isArray(value)) return value.map(stripForbidden);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      output[key] = stripForbidden(inner);
    }
    return output;
  }
  return value;
}

// Query one leaderboard GSI1 partition (ranked season or all-time), returning
// the raw ordered rows (best first). Season boards carry one row PER completed
// run, so a single grinder's many runs can fill a small page — page through
// (200/page, capped) and let the caller dedupe to distinct players, mirroring
// the API's own leaderboard read. `maxPages` bounds the walk (10 × 200 rows).
export async function queryLeaderboard(doc, partition, maxPages = 10) {
  const rows = [];
  let lastKey;
  let pages = 0;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": partition },
        ScanIndexForward: true,
        Limit: 200,
        ExclusiveStartKey: lastKey,
      }),
    );
    rows.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
    pages += 1;
  } while (lastKey && pages < maxPages);
  return rows;
}

export async function findEvidenceByRunId(doc, runId) {
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(sk, :evidence) AND runId = :runId",
        ExpressionAttributeValues: {
          ":evidence": "EVIDENCE#",
          ":runId": runId,
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    const evidence = (result.Items ?? [])[0];
    if (evidence) return evidence;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return undefined;
}

export async function loadDecisions(doc, runIds) {
  const decisions = new Map();
  const uniqueIds = [...new Set(runIds.filter(Boolean))];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    let keys = uniqueIds
      .slice(offset, offset + 100)
      .map((runId) => ({ pk: `REFEREE#${runId}`, sk: "CURRENT" }));
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const result = await doc.send(
        new BatchGetCommand({
          RequestItems: {
            [TABLE_NAME]: { Keys: keys, ConsistentRead: true },
          },
        }),
      );
      for (const item of result.Responses?.[TABLE_NAME] ?? []) {
        decisions.set(String(item.runId), item);
      }
      keys = result.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
    }
    if (keys.length)
      throw new Error(
        `Referee decisions remained unavailable for ${keys.length} run(s)`,
      );
  }
  return decisions;
}

export async function currentDecision(doc, runId) {
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `REFEREE#${runId}`, sk: "CURRENT" },
      ConsistentRead: true,
    }),
  );
  return result.Item;
}

function rowSortKey(row) {
  return typeof row.GSI1SK === "string"
    ? row.GSI1SK
    : `${String(row.score).padStart(16, "0")}#${row.completedAt}`;
}

function takeWithBoundaryTies(rows, limit) {
  if (rows.length <= limit) return rows;
  const boundary = rows[limit - 1];
  const sameResult = (row) =>
    row.score === boundary.score && row.timeMs === boundary.timeMs;
  let end = limit;
  while (end < rows.length && sameResult(rows[end])) end += 1;
  return rows.slice(0, end);
}

async function bestVisibleRun(doc, playerSub, mode, hiddenRunId) {
  const runs = [];
  let lastKey;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `PLAYER#${playerSub}`,
          ":prefix": "RUN#",
        },
        ExclusiveStartKey: lastKey,
        Limit: 500,
      }),
    );
    runs.push(
      ...(result.Items ?? []).filter(
        (item) => item.mode === mode && item.runId !== hiddenRunId,
      ),
    );
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && runs.length < 2_000);
  const decisions = await loadDecisions(
    doc,
    runs.map((run) => String(run.runId ?? "")).filter(Boolean),
  );
  return runs
    .filter((run) => decisions.get(String(run.runId))?.visibility !== "hidden")
    .sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)))[0];
}

async function resolveAllTimeEarningRun(doc, row, mode) {
  if (row.runId) return row;
  let lastKey;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `PLAYER#${row.playerSub}`,
          ":prefix": "RUN#",
        },
        ExclusiveStartKey: lastKey,
        Limit: 500,
      }),
    );
    const match = (result.Items ?? []).find(
      (item) =>
        item.mode === mode &&
        item.score === row.score &&
        item.completedAt === row.completedAt &&
        (row.timeMs === undefined || item.timeMs === row.timeMs),
    );
    if (match?.runId) return { ...row, runId: match.runId };
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  throw new Error(
    `All-time ${mode} entry at ${row.completedAt} has no resolvable earning run`,
  );
}

export async function visibleLeaderboardRows(
  doc,
  seasonId,
  mode,
  scope,
  limit,
) {
  let rows = await queryLeaderboard(doc, leaderboardPartition(seasonId, mode));
  if (scope === "all-time") {
    rows = await Promise.all(
      rows.map((row) => resolveAllTimeEarningRun(doc, row, mode)),
    );
  } else if (rows.some((row) => !row.runId)) {
    throw new Error(`Season ${mode} leaderboard contains a row without runId`);
  }
  const decisions = await loadDecisions(
    doc,
    rows.map((row) => String(row.runId ?? "")).filter(Boolean),
  );
  if (scope === "season") {
    const seen = new Set();
    const visible = [];
    for (const row of rows) {
      if (decisions.get(String(row.runId))?.visibility === "hidden") continue;
      const sub = String(row.playerSub);
      if (seen.has(sub)) continue;
      seen.add(sub);
      visible.push(row);
    }
    return {
      rows: takeWithBoundaryTies(visible, limit),
      decisions,
    };
  }

  const reconciled = await Promise.all(
    rows.map(async (row) => {
      if (decisions.get(String(row.runId))?.visibility !== "hidden") return row;
      return bestVisibleRun(
        doc,
        String(row.playerSub),
        mode,
        String(row.runId),
      );
    }),
  );
  const visible = reconciled
    .filter(Boolean)
    .sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));
  return { rows: takeWithBoundaryTies(visible, limit), decisions };
}

// Minimal --flag <value> / --flag parser. Bare flags become `true`.
export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

// The current leaderboard season id, read from the CR war-clock singleton the
// bridge maintains. Falls back to the UTC calendar month if the clock is absent.
export async function currentSeasonId(doc) {
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: "CR_WAR_CLOCK", sk: "CURRENT" },
      ProjectionExpression: "leaderboardSeasonId",
    }),
  );
  if (result.Item?.leaderboardSeasonId) return result.Item.leaderboardSeasonId;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand };
