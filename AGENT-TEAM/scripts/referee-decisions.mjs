#!/usr/bin/env node
// referee-decisions.mjs [--disposition <value>]
//   [--visibility visible|hidden|not_ranked]
//
// List current referee judgments for changed/unresolved-case review. Decision
// reasons are private output and must never be copied to public issues.

import {
  client,
  failClosed,
  parseFlags,
  print,
  sanitizeRecord,
  ScanCommand,
  TABLE_NAME,
} from "./_referee-lib.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const limit = Number(flags.limit || 200);
if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
  failClosed("invalid_limit", "--limit must be 1..1000");

const doc = client();
const decisions = [];
let lastKey;
try {
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(pk, :referee) AND sk = :current",
        ExpressionAttributeValues: {
          ":referee": "REFEREE#",
          ":current": "CURRENT",
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    decisions.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

const filtered = decisions
  .filter(
    (decision) =>
      (!flags.disposition || decision.disposition === flags.disposition) &&
      (!flags.visibility || decision.visibility === flags.visibility),
  )
  .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))
  .slice(0, limit)
  .map(sanitizeRecord);

print({ status: "ok", count: filtered.length, decisions: filtered });
