import type { GameMode } from "./types.js";

export type IntegrityReason =
  | "score_below_ui_floor"
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

export function assessRunIntegrity(
  mode: GameMode,
  score: number,
  wallElapsedMs: number,
): IntegrityAssessment {
  const scoreFloor = MIN_TIMED_SCORES[mode];
  if (scoreFloor !== undefined && score < scoreFloor)
    return { eligible: false, reason: "score_below_ui_floor" };

  if (mode === "practice" && wallElapsedMs < 14_000)
    return { eligible: false, reason: "completion_rate_above_ui_limit" };

  if (mode === "higher-lower") {
    const answered = score >= 250 ? score : score + 1;
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

  if (mode === "blitz" && score > 194)
    return { eligible: false, reason: "score_above_ui_ceiling" };

  return { eligible: true };
}
