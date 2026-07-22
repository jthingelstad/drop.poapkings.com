import { GAME_MODES, type GameMode, type ModeRule } from "./types.js";

export const MODE_RULES: Record<GameMode, ModeRule> = {
  surge: {
    direction: "lower",
    minScore: 1_000,
    maxScore: 3_600_000,
    scoreUnit: "milliseconds",
  },
  practice: {
    direction: "higher",
    minScore: 0,
    maxScore: 100,
    scoreUnit: "percent",
  },
  "higher-lower": {
    direction: "higher",
    minScore: 0,
    maxScore: 100_000,
    scoreUnit: "count",
  },
  trade: {
    direction: "lower",
    minScore: 500,
    maxScore: 3_600_000,
    scoreUnit: "milliseconds",
  },
  survival: {
    direction: "higher",
    minScore: 0,
    maxScore: 100_000,
    scoreUnit: "count",
  },
  rain: {
    direction: "higher",
    minScore: 0,
    maxScore: 100_000,
    scoreUnit: "count",
  },
};

export function isGameMode(value: unknown): value is GameMode {
  return (
    typeof value === "string" &&
    (GAME_MODES as readonly string[]).includes(value)
  );
}

// A completed ranked run still belongs in history and earns activity XP when
// the player scores zero, but it has not earned a place on a skill board.
export function isLeaderboardEligibleScore(score: number): boolean {
  return Number.isFinite(score) && score > 0;
}

const MAX_SORT_SCORE = 999_999_999_999;

// Bump a mode's board epoch to start its leaderboard fresh without touching or
// deleting data: new runs write to (and reads query) the new partition, so
// older entries are simply orphaned. Survival moved to "r2" when it became a
// clear-the-deck, time-ranked game — its pre-change scores are retired.
const BOARD_EPOCH: Partial<Record<GameMode, string>> = {
  survival: "r2",
};

export function leaderboardPartition(seasonId: string, mode: GameMode): string {
  const epoch = BOARD_EPOCH[mode];
  return epoch
    ? `LEADERBOARD#${seasonId}#${mode}#${epoch}`
    : `LEADERBOARD#${seasonId}#${mode}`;
}

export function leaderboardSortKey(
  mode: GameMode,
  score: number,
  completedAt: string,
  sub: string,
  tiebreakMs?: number,
): string {
  const sortableScore =
    MODE_RULES[mode].direction === "lower" ? score : MAX_SORT_SCORE - score;
  // An optional ascending tiebreak (Survival cumulative time): among equal
  // scores the smaller value sorts first, so the fastest clear ranks higher.
  const tiebreak =
    tiebreakMs === undefined
      ? ""
      : `#${String(Math.min(Math.max(0, Math.round(tiebreakMs)), 999_999_999)).padStart(9, "0")}`;
  return `${String(sortableScore).padStart(12, "0")}${tiebreak}#${completedAt}#${sub}`;
}
