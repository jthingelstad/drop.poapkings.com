import {
  GAME_MODES,
  type GameMode,
  type ModeRule,
  type RunTiebreaks,
  type TiebreakField,
} from "./types.js";

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
const MAX_TIEBREAK = 999_999_999;

// Bump a mode's board epoch to start its leaderboard fresh without touching or
// deleting data: new runs write to (and reads query) the new partition, so
// older entries are simply orphaned. Survival moved to "r2" when it became a
// clear-the-deck, time-ranked game — its pre-change scores are retired.
// Rain moved to "r2" on 2026-07-24 when its difficulty stopped capping: the old
// curve flatlined at 50 clears, so a player in flow could clear indefinitely and
// deep scores came off a materially easier game. Post-redesign runs are not
// comparable to them, so the board restarts rather than freezing an old record
// behind a much harder climb.
// Higher/Lower moved to "r2" on 2026-07-25 when it gained three lives and a
// gap-ramped deal: a one-life score was "how far before the first mistake" over
// uniformly random pairs, and the score is now total correct reads across a
// whole session that survives two misses. The two numbers are not the same
// measurement, so they cannot share a board.
const BOARD_EPOCH: Partial<Record<GameMode, string>> = {
  survival: "r2",
  rain: "r2",
  "higher-lower": "r2",
};

// The ordered ascending tiebreaks a mode ranks equal scores by, named by the
// run attribute that carries each value. ARRAY ORDER IS RANKING ORDER:
// Higher/Lower separates equal scores by fewest lives lost first, and only then
// by the faster cumulative time.
const MODE_TIEBREAKS: Partial<Record<GameMode, readonly TiebreakField[]>> = {
  survival: ["timeMs"],
  "higher-lower": ["livesLost", "timeMs"],
};

export function modeTiebreakFields(mode: GameMode): readonly TiebreakField[] {
  return MODE_TIEBREAKS[mode] ?? [];
}

// The tiebreak attributes one run row should carry, narrowed to the fields the
// mode actually ranks by. Written onto the row so the GSI1SK fallback can
// rebuild the exact sort key (and, for Survival's time, so the board can show
// it).
export function tiebreakAttributes(
  mode: GameMode,
  tiebreaks: RunTiebreaks | undefined,
): RunTiebreaks {
  const attributes: RunTiebreaks = {};
  for (const field of modeTiebreakFields(mode)) {
    const value = tiebreaks?.[field];
    if (typeof value === "number" && Number.isFinite(value))
      attributes[field] = value;
  }
  return attributes;
}

// The ordered tiebreak values a stored row carries, stopping at the first field
// the row does not have. A row written before a tiebreak field existed keeps
// producing exactly the key it was written with, so the fallback never invents
// a segment that the stored GSI1SK does not have.
export function tiebreakValues(
  mode: GameMode,
  source: Record<string, unknown>,
): number[] {
  const values: number[] = [];
  for (const field of modeTiebreakFields(mode)) {
    const raw = source[field];
    if (raw === undefined) break;
    values.push(Number(raw));
  }
  return values;
}

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
  tiebreaks?: number | readonly number[],
): string {
  const sortableScore =
    MODE_RULES[mode].direction === "lower" ? score : MAX_SORT_SCORE - score;
  // Zero or more ascending tiebreaks, applied in order: among equal scores the
  // smaller first value sorts first, ties there fall to the second, and so on
  // (Survival's cumulative time; Higher/Lower's lives lost, then time).
  //
  // Every row inside ONE leaderboard partition must emit the same number of
  // segments — mixing shapes breaks the lexicographic order, because a 9-digit
  // tiebreak and an ISO timestamp are being compared at the same offset. That
  // is why a second tiebreak arrives with a fresh board epoch.
  const ordered =
    tiebreaks === undefined
      ? []
      : typeof tiebreaks === "number"
        ? [tiebreaks]
        : tiebreaks;
  const tiebreak = ordered
    .map(
      (value) =>
        `#${String(Math.min(Math.max(0, Math.round(value)), MAX_TIEBREAK)).padStart(9, "0")}`,
    )
    .join("");
  return `${String(sortableScore).padStart(12, "0")}${tiebreak}#${completedAt}#${sub}`;
}
