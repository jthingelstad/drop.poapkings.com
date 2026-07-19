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
  identify: {
    direction: "lower",
    minScore: 1_000,
    maxScore: 3_600_000,
    scoreUnit: "milliseconds",
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
  ladder: {
    direction: "lower",
    minScore: 500,
    maxScore: 3_600_000,
    scoreUnit: "milliseconds",
  },
  "endless-ladder": {
    direction: "higher",
    minScore: 0,
    maxScore: 100_000,
    scoreUnit: "count",
  },
  "cost-sweep": {
    direction: "higher",
    minScore: 0,
    maxScore: 10_000,
    scoreUnit: "count",
  },
  blitz: {
    direction: "higher",
    minScore: 0,
    maxScore: 10_000,
    scoreUnit: "count",
  },
  survival: {
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

const MAX_SORT_SCORE = 999_999_999_999;

export function leaderboardSortKey(
  mode: GameMode,
  score: number,
  completedAt: string,
  sub: string,
): string {
  const sortableScore =
    MODE_RULES[mode].direction === "lower" ? score : MAX_SORT_SCORE - score;
  return `${String(sortableScore).padStart(12, "0")}#${completedAt}#${sub}`;
}
