#!/usr/bin/env node
// referee-player.mjs <playerId>
//
// Bounded run history + progression context for one pseudonymous player: scores
// over time, grouped per mode. Maps playerId -> sub internally, then queries the
// PLAYER#{sub} run history. Emits playerId only — never sub or email.

import {
  client,
  failClosed,
  parseFlags,
  print,
  QueryCommand,
  sanitize,
  subForPlayerId,
  TABLE_NAME,
} from "./_referee-lib.mjs";

const { positional } = parseFlags(process.argv.slice(2));
const playerId = positional[0];
if (!playerId) failClosed("missing_player_id", "usage: referee-player.mjs <playerId>");

const doc = client();

let sub;
try {
  sub = await subForPlayerId(doc, playerId);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (!sub) failClosed("player_not_found", `No profile maps to playerId ${playerId}`);

const runs = [];
let lastKey;
try {
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `PLAYER#${sub}`, ":prefix": "RUN#" },
        ScanIndexForward: true,
        ExclusiveStartKey: lastKey,
        Limit: 500,
      }),
    );
    for (const item of result.Items ?? []) runs.push(item);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && runs.length < 2_000);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

// Per-mode progression: scores in completion order.
const byMode = {};
for (const run of runs) {
  const mode = String(run.mode);
  (byMode[mode] ??= []).push({
    runId: run.runId,
    score: run.score,
    seasonId: run.seasonId,
    completedAt: run.completedAt,
    ...(run.timeMs !== undefined ? { timeMs: run.timeMs } : {}),
  });
}

print(
  sanitize(
    {
      status: "ok",
      totalRuns: runs.length,
      firstSeen: runs[0]?.completedAt,
      lastSeen: runs.at(-1)?.completedAt,
      progression: byMode,
    },
    playerId,
  ),
);
