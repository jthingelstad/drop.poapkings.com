#!/usr/bin/env node
// referee-players.mjs [--limit 500]
//
// Sanitized operator directory for Drop Control Room. The script reads only
// public/pseudonymous profile fields, run metadata, badge progress, and the
// bounded referee overlay. Raw subjects and email addresses are never emitted.

import {
  client,
  failClosed,
  parseFlags,
  playerReference,
  print,
  runReference,
  sanitizeRecord,
  ScanCommand,
  TABLE_NAME,
} from "./_referee-lib.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const limit = Number(flags.limit || 500);
if (!Number.isInteger(limit) || limit < 1 || limit > 2_000)
  failClosed("invalid_limit", "--limit must be 1..2000");

async function scan(filter, names, values, projection) {
  const rows = [];
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: filter,
        ...(names ? { ExpressionAttributeNames: names } : {}),
        ...(values ? { ExpressionAttributeValues: values } : {}),
        ...(projection ? { ProjectionExpression: projection } : {}),
        ExclusiveStartKey: lastKey,
      }),
    );
    rows.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return rows;
}

const doc = await client();
let profiles;
let runs;
let badges;
let decisions;
try {
  [profiles, runs, badges, decisions] = await Promise.all([
    scan(
      "sk = :profile",
      undefined,
      { ":profile": "PROFILE" },
      "pk, playerId, publicName, favoriteCardId, playerTag, totalGames, xp, createdAt, updatedAt",
    ),
    scan(
      "begins_with(sk, :run)",
      { "#mode": "mode" },
      { ":run": "RUN#" },
      "pk, runId, #mode, score, completedAt",
    ),
    scan(
      "sk = :badges",
      undefined,
      { ":badges": "BADGES" },
      "pk, earned, updatedAt",
    ),
    scan("begins_with(pk, :referee) AND sk = :current", undefined, {
      ":referee": "REFEREE#",
      ":current": "CURRENT",
    }),
  ]);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

const profileBySub = new Map();
for (const profile of profiles) {
  if (
    typeof profile.pk !== "string" ||
    !profile.pk.startsWith("PLAYER#") ||
    typeof profile.playerId !== "string"
  )
    continue;
  const sub = profile.pk.slice("PLAYER#".length);
  profileBySub.set(sub, {
    playerId: profile.playerId,
    playerReference: playerReference(profile.playerId),
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    totalGames: Number(profile.totalGames ?? 0),
    xp: Number(profile.xp ?? 0),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastSeen: undefined,
    runCount: 0,
    modes: {},
    reviewedRuns: 0,
    pendingRuns: 0,
    excludedRuns: 0,
    earnedBadges: 0,
    rankedAccess: "allowed",
  });
}

const playerByRun = new Map();
const runById = new Map();
for (const run of runs) {
  if (typeof run.pk !== "string" || !run.pk.startsWith("PLAYER#")) continue;
  const player = profileBySub.get(run.pk.slice("PLAYER#".length));
  if (!player || typeof run.runId !== "string") continue;
  playerByRun.set(run.runId, player);
  runById.set(run.runId, run);
  player.runCount += 1;
  const mode = String(run.mode ?? "unknown");
  player.modes[mode] = (player.modes[mode] ?? 0) + 1;
  if (
    typeof run.completedAt === "string" &&
    (!player.lastSeen || run.completedAt > player.lastSeen)
  )
    player.lastSeen = run.completedAt;
}

for (const badge of badges) {
  if (typeof badge.pk !== "string" || !badge.pk.startsWith("PLAYER#")) continue;
  const player = profileBySub.get(badge.pk.slice("PLAYER#".length));
  if (!player || !badge.earned || typeof badge.earned !== "object") continue;
  player.earnedBadges = Object.values(badge.earned).filter(
    (stamps) => Array.isArray(stamps) && stamps.length > 0,
  ).length;
}

for (const decision of decisions) {
  if (typeof decision.runId === "string") {
    const player = playerByRun.get(decision.runId);
    if (!player) continue;
    if (decision.queueState === "pending") player.pendingRuns += 1;
    else if (decision.visibility === "hidden") player.excludedRuns += 1;
    else player.reviewedRuns += 1;
  } else if (
    typeof decision.playerId === "string" &&
    profileBySub
      .values()
      .some((player) => player.playerId === decision.playerId)
  ) {
    for (const player of profileBySub.values()) {
      if (player.playerId === decision.playerId)
        player.rankedAccess =
          decision.status === "restricted" ? "restricted" : "allowed";
    }
  }
}

const players = [...profileBySub.values()]
  .sort((left, right) =>
    String(right.lastSeen ?? right.updatedAt ?? "").localeCompare(
      String(left.lastSeen ?? left.updatedAt ?? ""),
    ),
  )
  .slice(0, limit)
  .map((player) => sanitizeRecord(player));

const totals = {
  players: profileBySub.size,
  runs: runs.length,
  pending: [...profileBySub.values()].reduce(
    (sum, player) => sum + player.pendingRuns,
    0,
  ),
  restricted: [...profileBySub.values()].filter(
    (player) => player.rankedAccess === "restricted",
  ).length,
};

const reviewQueue = decisions
  .filter(
    (decision) =>
      typeof decision.runId === "string" && decision.queueState === "pending",
  )
  .map((decision) => {
    const run = runById.get(decision.runId);
    const player = playerByRun.get(decision.runId);
    return sanitizeRecord({
      runId: decision.runId,
      runReference: runReference(decision.runId),
      playerId: player?.playerId,
      playerReference: player?.playerReference,
      publicName: player?.publicName,
      mode: run?.mode,
      score: run?.score,
      completedAt: run?.completedAt,
      decidedAt: decision.decidedAt,
      reason: decision.reason,
      subjectType: decision.subjectType,
    });
  })
  .sort((left, right) =>
    String(left.decidedAt ?? left.completedAt ?? "").localeCompare(
      String(right.decidedAt ?? right.completedAt ?? ""),
    ),
  );

print({
  status: "ok",
  generatedAt: new Date().toISOString(),
  totals,
  players,
  reviewQueue,
  recentRuns: runs
    .filter((run) => typeof run.runId === "string")
    .sort((left, right) =>
      String(right.completedAt ?? "").localeCompare(
        String(left.completedAt ?? ""),
      ),
    )
    .slice(0, 20)
    .map((run) => {
      const player = playerByRun.get(String(run.runId));
      return {
        runId: run.runId,
        runReference: runReference(String(run.runId)),
        playerId: player?.playerId,
        playerReference: player?.playerReference,
        publicName: player?.publicName,
        mode: run.mode,
        score: run.score,
        completedAt: run.completedAt,
      };
    }),
});
