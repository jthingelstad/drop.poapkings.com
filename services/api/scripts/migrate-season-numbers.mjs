#!/usr/bin/env node

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { planSeasonNumberMigration } from "../src/maintenance/season-number-migration.js";

const PRODUCTION_ACCOUNT = "999153317627";
const PRODUCTION_CALLER = `arn:aws:iam::${PRODUCTION_ACCOUNT}:user/jamie`;
const DEFAULT_TABLE = "elixir-drop";
const DEFAULT_REGION = "us-east-1";
const APPLY_CONCURRENCY = 10;

function parseArgs(argv) {
  const options = {
    apply: false,
    tableName: DEFAULT_TABLE,
    region: DEFAULT_REGION,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--table" || argument === "--region") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value`);
      if (argument === "--table") options.tableName = value;
      else options.region = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function clients(region) {
  const base = new DynamoDBClient({ region });
  return {
    doc: DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    }),
    sts: new STSClient({ region }),
  };
}

async function inventory(doc, tableName) {
  const actions = [];
  const unresolved = new Map();
  const seasons = new Map();
  let scanned = 0;
  let cursor;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: cursor,
        ConsistentRead: false,
      }),
    );
    scanned += result.ScannedCount ?? 0;
    for (const item of result.Items ?? []) {
      const plan = planSeasonNumberMigration(item);
      if (plan.unresolved) {
        unresolved.set(
          plan.unresolved,
          (unresolved.get(plan.unresolved) ?? 0) + 1,
        );
        continue;
      }
      if (!plan.action) continue;
      actions.push(plan.action);
      if (plan.action.seasonId !== undefined) {
        seasons.set(
          plan.action.seasonId,
          (seasons.get(plan.action.seasonId) ?? 0) + 1,
        );
      }
    }
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return { scanned, actions, unresolved, seasons };
}

function summary(inventoryResult, status) {
  const byKind = {};
  for (const action of inventoryResult.actions) {
    const key =
      action.kind === "rewrite"
        ? `${action.kind}:${action.shape}`
        : action.kind;
    byKind[key] = (byKind[key] ?? 0) + 1;
  }
  return {
    status,
    scanned: inventoryResult.scanned,
    plannedActions: inventoryResult.actions.length,
    byKind,
    seasons: Object.fromEntries(
      [...inventoryResult.seasons].sort(([a], [b]) => a - b),
    ),
    unresolved: Object.fromEntries(
      [...inventoryResult.unresolved].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

async function applyUpdate(doc, tableName, action) {
  const sets = [];
  const removes = [];
  const names = {};
  const values = {};
  const conditions = [];
  if (action.seasonId !== undefined) {
    names["#seasonId"] = "seasonId";
    values[":seasonId"] = action.seasonId;
    values[":legacySeasonId"] = action.legacySeasonId;
    sets.push("#seasonId = :seasonId");
    conditions.push("#seasonId = :legacySeasonId");
  }
  if (action.gsi1pk !== undefined) {
    names["#gsi1pk"] = "GSI1PK";
    values[":gsi1pk"] = action.gsi1pk;
    values[":legacyGsi1pk"] = action.legacyGsi1pk;
    sets.push("#gsi1pk = :gsi1pk");
    conditions.push("#gsi1pk = :legacyGsi1pk");
  }
  if (action.removeLeaderboardSeasonId) {
    names["#leaderboardSeasonId"] = "leaderboardSeasonId";
    removes.push("#leaderboardSeasonId");
    conditions.push("attribute_exists(#leaderboardSeasonId)");
  }
  await doc.send(
    new UpdateCommand({
      TableName: tableName,
      Key: action.key,
      UpdateExpression: [
        sets.length ? `SET ${sets.join(", ")}` : "",
        removes.length ? `REMOVE ${removes.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      ConditionExpression: conditions.join(" AND "),
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length
        ? { ExpressionAttributeValues: values }
        : {}),
    }),
  );
}

async function applyRewrite(doc, tableName, action) {
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: action.item,
            ConditionExpression:
              "attribute_not_exists(pk) AND attribute_not_exists(sk)",
          },
        },
        {
          Delete: {
            TableName: tableName,
            Key: action.key,
            ConditionExpression:
              "attribute_exists(pk) AND attribute_exists(sk)",
          },
        },
      ],
    }),
  );
}

async function applyActions(doc, tableName, actions) {
  let applied = 0;
  for (let offset = 0; offset < actions.length; offset += APPLY_CONCURRENCY) {
    const batch = actions.slice(offset, offset + APPLY_CONCURRENCY);
    await Promise.all(
      batch.map((action) =>
        action.kind === "update"
          ? applyUpdate(doc, tableName, action)
          : applyRewrite(doc, tableName, action),
      ),
    );
    applied += batch.length;
    if (applied % 250 === 0 || applied === actions.length)
      process.stderr.write(`Applied ${applied}/${actions.length}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { doc, sts } = clients(options.region);
  const before = await inventory(doc, options.tableName);
  process.stdout.write(
    `${JSON.stringify(summary(before, "dry-run"), null, 2)}\n`,
  );
  if (!options.apply) return;
  if (before.unresolved.size)
    throw new Error("Migration refused because unresolved item shapes remain");
  if (options.tableName !== DEFAULT_TABLE || options.region !== DEFAULT_REGION)
    throw new Error("Apply is restricted to the production Elixir Drop table");
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (
    identity.Account !== PRODUCTION_ACCOUNT ||
    identity.Arn !== PRODUCTION_CALLER
  )
    throw new Error("Apply requires the bounded production operator identity");
  await applyActions(doc, options.tableName, before.actions);
  const after = await inventory(doc, options.tableName);
  process.stdout.write(
    `${JSON.stringify(summary(after, "verified"), null, 2)}\n`,
  );
  if (after.actions.length || after.unresolved.size)
    throw new Error("Post-migration inventory did not converge to zero");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Season migration failed"}\n`,
  );
  process.exitCode = 1;
});
