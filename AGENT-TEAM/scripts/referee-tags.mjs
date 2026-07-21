#!/usr/bin/env node
// referee-tags.mjs
//
// Normalized player-tag clusters across Drop accounts. Queries the sparse GSI2
// "TAGGED" partition (one row per tagged account, GSI2SK = "{tag}#{playerId}")
// and groups pseudonymous playerIds by tag. Emits playerId only — never sub or
// email. Tag reuse is a signal, NOT proof of shared ownership (tags are
// unverified); the referee treats it accordingly.

import {
  client,
  failClosed,
  print,
  QueryCommand,
  TABLE_NAME,
} from "./_referee-lib.mjs";

const doc = client();

const byTag = new Map();
let lastKey;
try {
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :tagged",
        ExpressionAttributeValues: { ":tagged": "TAGGED" },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      const sk = String(item.GSI2SK);
      const playerId = String(item.playerId);
      // GSI2SK is "{tag}#{playerId}"; playerId (a UUID) has no "#", so strip it
      // from the end to recover the tag verbatim.
      const tag = sk.endsWith(`#${playerId}`)
        ? sk.slice(0, sk.length - playerId.length - 1)
        : sk;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(playerId);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

const clusters = [...byTag.entries()]
  .map(([playerTag, accounts]) => ({ playerTag, accounts }))
  // Multi-account tags first — those are the meaningful clusters.
  .sort((a, b) => b.accounts.length - a.accounts.length);

print({ status: "ok", tagCount: clusters.length, clusters });
