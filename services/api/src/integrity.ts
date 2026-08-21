import { rainSpawnFloorMs } from "@elixir-drop/contracts";
import { MODE_RULES } from "./games.js";
import { RAIN_FLOOR_TOLERANCE_MS } from "./scoring.js";
import type { GameMode } from "./types.js";

export type IntegrityReason =
  | "score_out_of_range"
  | "score_below_ui_floor"
  | "completion_rate_above_ui_limit";

export type IntegrityAssessment =
  { eligible: true } | { eligible: false; reason: IntegrityReason };

const MIN_TIMED_SCORES: Partial<Record<GameMode, number>> = {
  surge: 4_500,
  // The 10-rung ladder forces a 280ms beat between correct rounds, so nine
  // beats alone put a legal run at 2,520ms before a single answer is read. A
  // 2,000 floor could therefore never fire — it left a window where a
  // fabricated time was structurally impossible yet passed the check meant to
  // catch it. Keep this above the forced-beat total whenever the ladder length
  // or CORRECT_BEAT_MS changes.
  trade: 3_000,
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

  if (mode === "rain") {
    // Rain's difficulty is a deterministic function of the cleared count, so the
    // first `score` spawn gaps are time the run cannot have skipped: a tile that
    // has not spawned cannot be cleared. This is the same floor the scorer
    // checks the transcript's own stamps against, measured here against the
    // server's wall clock instead — the one number in a completion that no
    // client can write. It is why the mode is bounded at all: nothing else about
    // Rain has a round length, a clock, or an end.
    if (wallElapsedMs + RAIN_FLOOR_TOLERANCE_MS < rainSpawnFloorMs(score))
      return { eligible: false, reason: "completion_rate_above_ui_limit" };
  }

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

  if (mode === "practice") {
    // Practice now pays one XP per two resolved cards. It stays unranked, but
    // the server wall clock must still prove that a bulk transcript could have
    // passed through the real 300ms correct-answer hold. A two-second grace
    // keeps startup/art variance and very short sessions out of the way.
    const cards = Math.max(0, roundsPresented ?? 0);
    if (wallElapsedMs + 2_000 < cards * 250)
      return { eligible: false, reason: "completion_rate_above_ui_limit" };
  }

  return { eligible: true };
}
