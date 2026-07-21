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
  leaderboardPartition,
  parseFlags,
  playerIdForSub,
  print,
  queryLeaderboard,
  RANKED_MODES,
} from "./_referee-lib.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const mode = flags.mode;
const scope = flags.scope || "season";
const limit = Number(flags.limit || 25);

if (!RANKED_MODES.includes(mode))
  failClosed("invalid_mode", `--mode must be one of ${RANKED_MODES.join(", ")}`);
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
const partition = leaderboardPartition(seasonId, mode);

let rows;
try {
  // Page through the partition; the loop below dedupes to `limit` distinct
  // players (a grinder's many runs must not crowd the cohort down to one entry).
  rows = await queryLeaderboard(doc, partition);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

const seen = new Set();
const entries = [];
for (const row of rows) {
  const sub = String(row.playerSub);
  // Season boards carry one row per completed run; dedupe to one entry per
  // player (their best in this partition sorts first). All-time already stores
  // one row per player.
  if (seen.has(sub)) continue;
  seen.add(sub);
  const playerId = await playerIdForSub(doc, sub);
  if (!playerId) continue; // deleted account: no reviewable player
  entries.push({
    rank: entries.length + 1,
    playerId,
    runId: row.runId,
    score: row.score,
    completedAt: row.completedAt,
    ...(row.timeMs !== undefined ? { timeMs: row.timeMs } : {}),
  });
  if (entries.length >= limit) break;
}

print({ status: "ok", mode, scope, seasonId, count: entries.length, entries });
