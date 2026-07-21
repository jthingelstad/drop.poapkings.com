#!/usr/bin/env node
// referee-cohort.mjs --mode <m> --scope season|all-time [--limit 25] [--season <id>]
//
// The top cohort for one ranked mode. Queries the leaderboard GSI1 partition and
// returns ranked rows resolved to { rank, playerId, runId, score }. Feed each
// runId to referee-run.mjs for the full evidence.

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
const mode = flags.mode;
const scope = flags.scope || "season";
const limit = Number(flags.limit || 25);

if (!RANKED_MODES.includes(mode))
  failClosed(
    "invalid_mode",
    `--mode must be one of ${RANKED_MODES.join(", ")}`,
  );
if (scope !== "season" && scope !== "all-time")
  failClosed("invalid_scope", "--scope must be season or all-time");
if (!Number.isInteger(limit) || limit < 1 || limit > 200)
  failClosed("invalid_limit", "--limit must be 1..200");

const doc = client();

const seasonId =
  scope === "all-time"
    ? "ALLTIME"
    : flags.season && flags.season !== true
      ? flags.season
      : await currentSeasonId(doc);
// Resolve current visibility before ranking. A hidden seasonal run falls back
// to that player's next-best run; all-time does the same reconciliation rather
// than dropping the player entirely.
let rows;
try {
  ({ rows } = await visibleLeaderboardRows(doc, seasonId, mode, scope, limit));
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

let decisions;
try {
  decisions = await loadDecisions(
    doc,
    rows.map((row) => String(row.runId ?? "")).filter(Boolean),
  );
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
const entries = [];
try {
  for (const row of rows) {
    const sub = String(row.playerSub);
    const playerId = await playerIdForSub(doc, sub);
    if (!playerId) continue; // deleted account: no reviewable player
    const decision = decisions.get(String(row.runId));
    entries.push({
      rank: entries.length + 1,
      playerId,
      runId: row.runId,
      score: row.score,
      completedAt: row.completedAt,
      ...(row.timeMs !== undefined ? { timeMs: row.timeMs } : {}),
      ...(decision ? { decision: sanitizeRecord(decision) } : {}),
    });
  }
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

print({ status: "ok", mode, scope, seasonId, count: entries.length, entries });
