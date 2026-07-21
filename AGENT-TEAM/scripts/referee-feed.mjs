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
  sanitizeRecord,
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
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

// Newest first so the referee processes the freshest entries first.
entries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));

print({ status: "ok", since, count: entries.length, entries });
