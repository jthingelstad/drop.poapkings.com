#!/usr/bin/env node
// Rebuild PLAYER#{sub}/ALLTIME#{mode} projections from immutable ranked run
// history. Dry-run by default; pass --apply to write. Idempotent and safe to
// rerun: each update is conditioned against a concurrently better projection.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  paginateScan,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.argv.includes("--table")
  ? process.argv[process.argv.indexOf("--table") + 1]
  : process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
const APPLY = process.argv.includes("--apply");
const DETAILS = process.argv.includes("--details");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
if (!REGION) throw new Error("Set AWS_REGION before running the backfill");
if (!TABLE_NAME || TABLE_NAME.startsWith("--"))
  throw new Error("--table requires a table name");

const RANKED_MODES = new Set([
  "surge",
  "higher-lower",
  "trade",
  "survival",
  "rain",
]);
const LOWER_IS_BETTER = new Set(["surge", "trade"]);
const MAX_SORT_SCORE = 999_999_999_999;
const MAX_TIEBREAK = 999_999_999;
const BOARD_EPOCH = {
  survival: "r2",
  rain: "r3",
  "higher-lower": "r2",
  trade: "r2",
};
const MODE_TIEBREAKS = {
  survival: ["timeMs"],
  "higher-lower": ["livesLost", "timeMs"],
  rain: ["wrongGuesses", "avgLatencyMs"],
};
const ALL_TIEBREAK_FIELDS = [
  "timeMs",
  "livesLost",
  "wrongGuesses",
  "avgLatencyMs",
];

function leaderboardPartition(seasonId, mode) {
  const epoch = BOARD_EPOCH[mode];
  return `LEADERBOARD#${seasonId}#${mode}${epoch ? `#${epoch}` : ""}`;
}

function tiebreakValues(mode, source) {
  const values = [];
  for (const field of MODE_TIEBREAKS[mode] ?? []) {
    if (!Number.isFinite(source[field])) break;
    values.push(source[field]);
  }
  return values;
}

function leaderboardSortKey(mode, score, completedAt, sub, tiebreaks = []) {
  const sortableScore = LOWER_IS_BETTER.has(mode)
    ? score
    : MAX_SORT_SCORE - score;
  const tiebreak = tiebreaks
    .map(
      (value) =>
        `#${String(Math.min(Math.max(0, Math.round(value)), MAX_TIEBREAK)).padStart(9, "0")}`,
    )
    .join("");
  return `${String(sortableScore).padStart(12, "0")}${tiebreak}#${completedAt}#${sub}`;
}

function rankedHistory(item) {
  if (
    typeof item.pk !== "string" ||
    !item.pk.startsWith("PLAYER#") ||
    typeof item.sk !== "string" ||
    !item.sk.startsWith("RUN#") ||
    !RANKED_MODES.has(item.mode) ||
    !Number.isFinite(item.score) ||
    item.score <= 0 ||
    typeof item.completedAt !== "string" ||
    typeof item.runId !== "string" ||
    typeof item.GSI1PK !== "string"
  )
    return false;
  // Survival's pre-r2 rules are intentionally retired and must not re-enter
  // the current all-time board. Other ranked modes have no board epoch.
  return item.GSI1PK === leaderboardPartition(item.seasonId, item.mode);
}

function projectionKey(sub, mode) {
  return `${sub}\0${mode}`;
}

const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  {
    marshallOptions: { removeUndefinedValues: true },
  },
);

const items = [];
for await (const page of paginateScan(
  { client: doc },
  {
    TableName: TABLE_NAME,
    ProjectionExpression:
      "pk, sk, runId, #mode, score, seasonId, completedAt, playerSub, boardEpoch, timeMs, livesLost, wrongGuesses, avgLatencyMs, GSI1PK, GSI1SK",
    ExpressionAttributeNames: { "#mode": "mode" },
  },
))
  items.push(...(page.Items ?? []));

const desired = new Map();
const current = new Map();
for (const item of items) {
  if (
    typeof item.pk === "string" &&
    item.pk.startsWith("PLAYER#") &&
    typeof item.sk === "string" &&
    item.sk.startsWith("ALLTIME#") &&
    RANKED_MODES.has(item.mode)
  ) {
    current.set(
      projectionKey(item.pk.slice("PLAYER#".length), item.mode),
      item,
    );
  }
  if (!rankedHistory(item)) continue;
  const sub = item.pk.slice("PLAYER#".length);
  const candidate = {
    sub,
    mode: item.mode,
    score: item.score,
    completedAt: item.completedAt,
    runId: item.runId,
    ...(BOARD_EPOCH[item.mode] ? { boardEpoch: BOARD_EPOCH[item.mode] } : {}),
  };
  for (const field of MODE_TIEBREAKS[item.mode] ?? []) {
    if (Number.isFinite(item[field])) candidate[field] = item[field];
  }
  candidate.GSI1SK = leaderboardSortKey(
    candidate.mode,
    candidate.score,
    candidate.completedAt,
    candidate.sub,
    tiebreakValues(candidate.mode, candidate),
  );
  const key = projectionKey(sub, item.mode);
  const previous = desired.get(key);
  if (!previous || candidate.GSI1SK < previous.GSI1SK)
    desired.set(key, candidate);
}

const plan = [];
for (const [key, candidate] of desired) {
  const existing = current.get(key);
  const candidatePartition = leaderboardPartition("ALLTIME", candidate.mode);
  const sameProjection =
    existing?.GSI1PK === candidatePartition &&
    existing.GSI1SK === candidate.GSI1SK &&
    existing.runId === candidate.runId &&
    ALL_TIEBREAK_FIELDS.every((field) => existing[field] === candidate[field]);
  if (sameProjection) continue;
  if (
    existing?.GSI1PK === candidatePartition &&
    existing.GSI1SK < candidate.GSI1SK
  )
    continue;
  plan.push({
    ...candidate,
    action: existing
      ? existing.GSI1PK === candidatePartition
        ? "repair_or_improve"
        : "reset_retired_epoch"
      : "create",
  });
}

const byMode = Object.fromEntries(
  [...RANKED_MODES].map((mode) => [
    mode,
    plan.filter((item) => item.mode === mode).length,
  ]),
);
const result = {
  status: APPLY ? "applied" : "dry_run",
  table: TABLE_NAME,
  scannedItems: items.length,
  rankedHistoryRows: items.filter(rankedHistory).length,
  desiredProjections: desired.size,
  existingProjections: current.size,
  plannedUpdates: plan.length,
  plannedByMode: byMode,
  applied: 0,
  skippedForConcurrentBetter: 0,
  ...(DETAILS
    ? {
        updates: plan.map(
          ({
            mode,
            score,
            completedAt,
            runId,
            boardEpoch,
            action,
            ...fields
          }) => ({
            mode,
            score,
            completedAt,
            runId,
            ...(boardEpoch ? { boardEpoch } : {}),
            ...Object.fromEntries(
              ALL_TIEBREAK_FIELDS.filter(
                (field) => fields[field] !== undefined,
              ).map((field) => [field, fields[field]]),
            ),
            action,
          }),
        ),
      }
    : {}),
};

if (APPLY) {
  for (const candidate of plan) {
    const values = {
      ":gsi1pk": leaderboardPartition("ALLTIME", candidate.mode),
      ":newSk": candidate.GSI1SK,
      ":mode": candidate.mode,
      ":score": candidate.score,
      ":completedAt": candidate.completedAt,
      ":playerSub": candidate.sub,
      ":runId": candidate.runId,
    };
    const sets = [
      "GSI1PK = :gsi1pk",
      "GSI1SK = :newSk",
      "#mode = :mode",
      "score = :score",
      "completedAt = :completedAt",
      "playerSub = :playerSub",
      "runId = :runId",
    ];
    if (candidate.boardEpoch) {
      sets.push("boardEpoch = :boardEpoch");
      values[":boardEpoch"] = candidate.boardEpoch;
    }
    for (const field of ALL_TIEBREAK_FIELDS) {
      if (candidate[field] === undefined) continue;
      sets.push(`${field} = :${field}`);
      values[`:${field}`] = candidate[field];
    }
    const removes = [
      ...(candidate.boardEpoch ? [] : ["boardEpoch"]),
      ...ALL_TIEBREAK_FIELDS.filter((field) => candidate[field] === undefined),
    ];
    try {
      await doc.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `PLAYER#${candidate.sub}`,
            sk: `ALLTIME#${candidate.mode}`,
          },
          UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
          ConditionExpression:
            "attribute_not_exists(GSI1SK) OR GSI1PK <> :gsi1pk OR :newSk <= GSI1SK",
          ExpressionAttributeNames: { "#mode": "mode" },
          ExpressionAttributeValues: values,
        }),
      );
      result.applied += 1;
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException") {
        result.skippedForConcurrentBetter += 1;
        continue;
      }
      throw error;
    }
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
