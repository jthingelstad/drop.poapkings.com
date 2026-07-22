#!/usr/bin/env node
// Remove only sparse leaderboard-index attributes from completed runs and
// all-time projections whose score is not positive. Canonical history, scores,
// XP, referee evidence, and player data remain untouched. Dry-run by default;
// pass --apply under the bounded leaderboard-maintenance role to write.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.argv.includes("--table")
  ? process.argv[process.argv.indexOf("--table") + 1]
  : process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
const APPLY = process.argv.includes("--apply");
const DETAILS = process.argv.includes("--details");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;

if (!REGION) throw new Error("Set AWS_REGION before running the cleanup");
if (!TABLE_NAME || TABLE_NAME.startsWith("--"))
  throw new Error("--table requires a table name");

const sts = new STSClient({ region: REGION });
const identity = await sts.send(new GetCallerIdentityCommand({}));
const callerArn = identity.Arn ?? "";
const maintenanceCaller = callerArn.includes(
  ":assumed-role/elixir-drop-leaderboard-maintenance/",
);
const refereeCaller = callerArn.includes(
  ":assumed-role/elixir-drop-referee-read/",
);
if (APPLY && !maintenanceCaller)
  throw new Error(
    "Apply requires the elixir-drop-leaderboard-maintenance assumed role",
  );
if (!APPLY && !maintenanceCaller && !refereeCaller)
  throw new Error(
    "Dry-run requires the referee-read or leaderboard-maintenance assumed role",
  );

const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

function candidateKind(item) {
  if (typeof item.sk !== "string") return undefined;
  if (item.sk.startsWith("RUN#")) return "history";
  if (item.sk.startsWith("ALLTIME#")) return "all-time";
  return undefined;
}

function isCandidate(item) {
  return (
    typeof item.pk === "string" &&
    item.pk.startsWith("PLAYER#") &&
    candidateKind(item) !== undefined &&
    typeof item.mode === "string" &&
    Number.isFinite(item.score) &&
    item.score <= 0 &&
    typeof item.GSI1PK === "string" &&
    item.GSI1PK.startsWith("LEADERBOARD#") &&
    typeof item.GSI1SK === "string"
  );
}

const candidates = [];
let scannedItems = 0;
let lastKey;
do {
  const result = await doc.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "attribute_exists(GSI1PK) AND score <= :zero",
      ProjectionExpression:
        "pk, sk, runId, #mode, score, seasonId, completedAt, GSI1PK, GSI1SK",
      ExpressionAttributeNames: { "#mode": "mode" },
      ExpressionAttributeValues: { ":zero": 0 },
      ExclusiveStartKey: lastKey,
    }),
  );
  scannedItems += result.ScannedCount ?? 0;
  candidates.push(...(result.Items ?? []).filter(isCandidate));
  lastKey = result.LastEvaluatedKey;
} while (lastKey);

const summary = {};
for (const item of candidates) {
  const key = `${item.mode}:${candidateKind(item)}`;
  summary[key] = (summary[key] ?? 0) + 1;
}

const output = {
  status: APPLY ? "applied" : "dry_run",
  table: TABLE_NAME,
  callerRole: maintenanceCaller ? "leaderboard-maintenance" : "referee-read",
  scannedItems,
  candidates: candidates.length,
  candidatesByModeAndKind: summary,
  removedProjections: 0,
  skippedChangedRows: 0,
  ...(DETAILS
    ? {
        rows: candidates.map((item) => ({
          kind: candidateKind(item),
          mode: item.mode,
          score: item.score,
          runId: item.runId,
          seasonId: item.seasonId,
          completedAt: item.completedAt,
          indexPartition: item.GSI1PK,
        })),
      }
    : {}),
};

if (APPLY) {
  for (const item of candidates) {
    try {
      await doc.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: "REMOVE GSI1PK, GSI1SK",
          ConditionExpression:
            "GSI1PK = :expectedPartition AND GSI1SK = :expectedSortKey",
          ExpressionAttributeValues: {
            ":expectedPartition": item.GSI1PK,
            ":expectedSortKey": item.GSI1SK,
          },
        }),
      );
      output.removedProjections += 1;
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException") {
        output.skippedChangedRows += 1;
        continue;
      }
      throw error;
    }
  }
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
