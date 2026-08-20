#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const API_CONFIG_PATH = path.join(REPO_ROOT, "apps/web/public/api-config.json");
const SEASON_ID_PATTERN = /^\d{4}-\d{2}(?:-\d+)?$/;

export const RANKED_MODES = Object.freeze([
  "surge",
  "higher-lower",
  "trade",
  "survival",
  "rain",
]);

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--free-pass-mode") {
      options.freePassMode = valueAfter(args, index, option);
      index += 1;
    } else if (option === "--season") {
      options.seasonId = valueAfter(args, index, option);
      index += 1;
    } else if (option === "--api-base-url") {
      options.apiBaseUrl = valueAfter(args, index, option);
      index += 1;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(option)}`);
    }
  }
  if (!RANKED_MODES.includes(options.freePassMode)) {
    throw new Error(
      `--free-pass-mode must be one of ${RANKED_MODES.join(", ")}`,
    );
  }
  if (options.seasonId && !SEASON_ID_PATTERN.test(options.seasonId)) {
    throw new Error("--season must be a Drop season id such as 2026-08");
  }
  return options;
}

function defaultApiBaseUrl() {
  const config = JSON.parse(readFileSync(API_CONFIG_PATH, "utf8"));
  if (typeof config.apiBaseUrl !== "string" || !config.apiBaseUrl) {
    throw new Error("api-config.json has no apiBaseUrl");
  }
  return config.apiBaseUrl;
}

function normalizedApiBaseUrl(value) {
  const url = new URL(value ?? defaultApiBaseUrl());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API base URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

async function readPublicJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`public API returned HTTP ${response.status}`);
  }
  return response.json();
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function seasonSummary(season, phase) {
  const id = requiredString(season?.id, "season id");
  const startsAt = requiredString(season?.startsAt, "season startsAt");
  const endsAt = requiredString(season?.endsAt, "season endsAt");
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
    throw new Error("season timing is invalid");
  }
  return {
    id,
    ...(Number.isSafeInteger(season.crSeasonId)
      ? { crSeasonId: season.crSeasonId }
      : {}),
    startsAt,
    endsAt,
    phase,
  };
}

function publicLeader(board, mode, seasonId) {
  if (board?.mode !== mode) {
    throw new Error(
      `${mode} board identified itself as ${String(board?.mode)}`,
    );
  }
  if (board?.seasonId !== seasonId || board?.scope !== "season") {
    throw new Error(`${mode} board returned the wrong season or scope`);
  }
  if (!Array.isArray(board.entries)) {
    throw new Error(`${mode} board entries are missing`);
  }
  const first = board.entries[0];
  if (!first) return { mode, visibleEntries: 0, leader: null };
  const publicName = requiredString(
    first.player?.publicName,
    `${mode} leader publicName`,
  );
  if (first.rank !== 1 || !Number.isFinite(first.score)) {
    throw new Error(`${mode} leader rank or score is invalid`);
  }
  const achievedAt = requiredString(first.achievedAt, `${mode} achievedAt`);
  if (Number.isNaN(Date.parse(achievedAt))) {
    throw new Error(`${mode} leader achievedAt is invalid`);
  }
  const reviewStatus =
    first.reviewStatus === "pending"
      ? "Awaiting"
      : first.reviewStatus === "reviewed"
        ? "Cleared"
        : null;
  return {
    mode,
    visibleEntries: board.entries.length,
    leader: {
      publicName,
      score: first.score,
      achievedAt,
      ...(Number.isSafeInteger(first.timeMs) ? { timeMs: first.timeMs } : {}),
      reviewStatus,
      provisional: reviewStatus === "Awaiting",
      finalEligible: reviewStatus === "Cleared",
    },
  };
}

export async function buildSeasonBrief(options) {
  if (!RANKED_MODES.includes(options.freePassMode)) {
    throw new Error(`freePassMode must be one of ${RANKED_MODES.join(", ")}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = normalizedApiBaseUrl(options.apiBaseUrl);
  const seasons = await readPublicJson(fetchImpl, `${apiBaseUrl}/seasons`);
  const current = seasons?.current;
  const upcoming = Array.isArray(seasons?.upcoming) ? seasons.upcoming : [];
  const currentId = requiredString(current?.id, "current season id");
  const seasonId = options.seasonId ?? currentId;
  if (!SEASON_ID_PATTERN.test(seasonId)) {
    throw new Error("season id is invalid");
  }
  const upcomingSeason = upcoming.find((season) => season?.id === seasonId);
  const selectedSeason =
    seasonId === currentId
      ? seasonSummary(current, "active")
      : upcomingSeason
        ? seasonSummary(upcomingSeason, "upcoming")
        : { id: seasonId, phase: "historical" };

  const boards = await Promise.all(
    RANKED_MODES.map((mode) =>
      readPublicJson(
        fetchImpl,
        `${apiBaseUrl}/leaderboards?mode=${encodeURIComponent(mode)}&season=${encodeURIComponent(seasonId)}`,
      ),
    ),
  );

  return {
    status: "ok",
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: "public-api",
    season: selectedSeason,
    freePassMode: options.freePassMode,
    boards: boards.map((board, index) =>
      publicLeader(board, RANKED_MODES[index], seasonId),
    ),
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await buildSeasonBrief(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "unavailable", reason: error.message })}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
