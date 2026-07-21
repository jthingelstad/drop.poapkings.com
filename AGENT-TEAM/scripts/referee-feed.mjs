#!/usr/bin/env node
// referee-feed.mjs --since <ISO>
//
// Incremental cohort feed: re-reads the top cohorts across every ranked mode
// (current season + all-time) and returns the entries whose run completed after
// the --since cursor. Phase 1 is a bounded re-read + diff; a dedicated feed GSI
// is a later option. Emits pseudonymous playerId + runId only.

import {
  client,
  currentSeasonId,
  failClosed,
  loadDecisions,
  parseFlags,
  playerIdForSub,
  print,
  RANKED_MODES,
  ScanCommand,
  sanitizeRecord,
  TABLE_NAME,
  visibleLeaderboardRows,
} from "./_referee-lib.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const since = flags.since;
if (!since || since === true)
  failClosed("missing_since", "usage: referee-feed.mjs --since <ISO>");
const sinceTime = Date.parse(since);
if (Number.isNaN(sinceTime))
  failClosed("invalid_since", "--since must be an ISO timestamp");

const doc = client();
const seasonId = await currentSeasonId(doc);

const entries = [];
try {
  for (const mode of RANKED_MODES) {
    for (const [scope, sid] of [
      ["season", seasonId],
      ["all-time", "ALLTIME"],
    ]) {
      const { rows } = await visibleLeaderboardRows(doc, sid, mode, scope, 25);
      const decisions = await loadDecisions(
        doc,
        rows.map((row) => String(row.runId ?? "")).filter(Boolean),
      );
      for (const row of rows) {
        if (!row.completedAt || Date.parse(row.completedAt) <= sinceTime)
          continue;
        const playerId = await playerIdForSub(doc, String(row.playerSub));
        if (!playerId) continue;
        const decision = decisions.get(String(row.runId));
        entries.push({
          scope,
          mode,
          seasonId: sid,
          playerId,
          runId: row.runId,
          score: row.score,
          completedAt: row.completedAt,
          ...(decision ? { decision: sanitizeRecord(decision) } : {}),
        });
      }
    }
  }

  // Unscored attempts are not discoverable through a leaderboard partition,
  // but they still require referee judgment. Include both the v2 name and the
  // legacy "rejected" evidence type so automatic scorer labels are never final.
  const unscored = [];
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression:
          "begins_with(sk, :evidence) AND completedAt > :since AND (#runType = :unscored OR #runType = :legacy)",
        ExpressionAttributeNames: { "#runType": "runType" },
        ExpressionAttributeValues: {
          ":evidence": "EVIDENCE#",
          ":since": new Date(sinceTime).toISOString(),
          ":unscored": "unscored",
          ":legacy": "rejected",
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    unscored.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  const unscoredDecisions = await loadDecisions(
    doc,
    unscored.map((item) => String(item.runId ?? "")).filter(Boolean),
  );
  for (const item of unscored) {
    const playerId = await playerIdForSub(doc, String(item.playerSub));
    if (!playerId) continue;
    const decision = unscoredDecisions.get(String(item.runId));
    entries.push({
      scope: "unscored",
      mode: item.mode,
      seasonId: item.seasonId,
      playerId,
      runId: item.runId,
      completedAt: item.completedAt,
      integrityOutcome: item.integrityOutcome,
      ...(decision ? { decision: sanitizeRecord(decision) } : {}),
    });
  }
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

// Newest first so the referee processes the freshest entries first.
entries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));

print({ status: "ok", since, count: entries.length, entries });
