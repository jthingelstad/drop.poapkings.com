import { MODE_RULES } from "./games.js";
import type { GameMode } from "./types.js";

export type IntegrityReason =
  | "score_out_of_range"
  | "score_below_ui_floor"
  | "completion_rate_above_ui_limit";

export type IntegrityAssessment =
  { eligible: true } | { eligible: false; reason: IntegrityReason };

const MIN_TIMED_SCORES: Partial<Record<GameMode, number>> = {
  surge: 4_500,
  trade: 2_000,
};

export function assessRunIntegrity(
  mode: GameMode,
  score: number,
  wallElapsedMs: number,
  // Rounds the run actually presented. Higher/Lower now survives two misses, so
  // its score is no longer the round count and the wall-clock floor has to be
  // measured against what the player was actually shown.
  roundsPresented?: number,
): IntegrityAssessment {
  const rule = MODE_RULES[mode];
  if (
    !Number.isSafeInteger(score) ||
    score < rule.minScore ||
    score > rule.maxScore
  )
    return { eligible: false, reason: "score_out_of_range" };

  const scoreFloor = MIN_TIMED_SCORES[mode];
  if (scoreFloor !== undefined && score < scoreFloor)
    return { eligible: false, reason: "score_below_ui_floor" };

  if (mode === "higher-lower") {
    // Each pair costs the player at least ~1s of real time: the reveal beat
    // alone holds 750ms before the next pair is dealt. Fall back to score + 1
    // (the shape from the one-life era) when the caller has no round count.
    const rounds =
      roundsPresented !== undefined && Number.isFinite(roundsPresented)
        ? roundsPresented
        : score + 1;
    if (wallElapsedMs + 2_000 < rounds * 1_000)
      return { eligible: false, reason: "completion_rate_above_ui_limit" };
  }

  return { eligible: true };
}
