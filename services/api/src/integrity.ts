import { MODE_RULES } from "./games.js";
import { HIGHER_LOWER_PAIR_COUNT } from "./scoring.js";
import type { GameMode } from "./types.js";

export type IntegrityReason =
  | "score_out_of_range"
  | "score_below_ui_floor"
  | "wall_time_below_ui_floor"
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

  if (mode === "practice" && wallElapsedMs < 14_000)
    return { eligible: false, reason: "wall_time_below_ui_floor" };

  if (mode === "higher-lower") {
    const answered = score >= HIGHER_LOWER_PAIR_COUNT ? score : score + 1;
    if (wallElapsedMs + 2_000 < answered * 1_000)
      return { eligible: false, reason: "completion_rate_above_ui_limit" };
  }

  return { eligible: true };
}
