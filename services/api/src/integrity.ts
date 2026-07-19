import { MODE_RULES } from "./games.js";
import { BLITZ_CARD_COUNT, HIGHER_LOWER_PAIR_COUNT } from "./scoring.js";
import type { GameMode } from "./types.js";

export type IntegrityReason =
  | "score_out_of_range"
  | "score_below_ui_floor"
  | "wall_time_below_ui_floor"
  | "completion_rate_above_ui_limit"
  | "score_above_ui_ceiling";

export type IntegrityAssessment =
  { eligible: true } | { eligible: false; reason: IntegrityReason };

const MIN_TIMED_SCORES: Partial<Record<GameMode, number>> = {
  surge: 4_500,
  identify: 4_500,
  trade: 2_000,
  ladder: 750,
};

// The best sustained Blitz pace the UI physically allows (~3.2 cards/s for
// 60s) rounds to this ceiling; a higher count did not come from the keypad.
const BLITZ_SCORE_CEILING = Math.min(194, BLITZ_CARD_COUNT);

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

  if (
    mode === "endless-ladder" &&
    score >= 5 &&
    wallElapsedMs + 2_000 < score * 180 + 400
  ) {
    return { eligible: false, reason: "completion_rate_above_ui_limit" };
  }

  if (mode === "blitz" && score > BLITZ_SCORE_CEILING)
    return { eligible: false, reason: "score_above_ui_ceiling" };

  return { eligible: true };
}
