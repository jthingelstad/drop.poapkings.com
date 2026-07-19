import type { GameMode } from "@elixir-drop/contracts";
import type { RunTranscript } from "./types.js";

// Player XP rewards CORRECTNESS. It is deliberately separate from the
// leaderboard, which rewards speed: a clean run earns full weight, a sloppy one
// earns a fraction, and raw volume alone earns little. XP is lifetime and only
// climbs — it is the "Drop activity score" that drives a player's arena tier.
//
// Timed / sudden-death modes weigh heaviest. Practice earns a reduced rate: it
// stays off every leaderboard, but genuine learning still moves your arena.
const MODE_WEIGHT: Record<GameMode, number> = {
  surge: 4,
  survival: 4,
  trade: 3,
  "higher-lower": 3,
  practice: 2,
  // Vaulted modes: sensible defaults so any historical or edge completion still
  // earns. They are unrouted, so this is a safety net, not a live path.
  identify: 3,
  ladder: 3,
  "endless-ladder": 3,
  "cost-sweep": 3,
  blitz: 3,
};

const DEFAULT_WEIGHT = 3;

interface Correctness {
  correct: number;
  total: number;
}

// The transcript is already validated by scoreRun before XP is computed, so
// this reads it leniently: any unexpected shape collapses to zero correct and
// the run still earns the participation floor.
function correctness(
  mode: GameMode,
  score: number,
  transcript: RunTranscript,
): Correctness {
  const answers = Array.isArray(transcript.answers)
    ? (transcript.answers as Array<Record<string, unknown>>)
    : [];
  switch (mode) {
    case "practice": {
      // score is already an accuracy percentage (0–100).
      const total = answers.length;
      return { correct: Math.round((score / 100) * total), total };
    }
    case "higher-lower":
    case "survival":
      // score is the count of correct answers before the run ended.
      return { correct: Math.max(0, Math.round(score)), total: answers.length };
    default: {
      // Guess-until-correct modes (surge, trade, identify, blitz): a first-try
      // answer is the mastery signal.
      const firstTry = answers.filter(
        (answer) => Array.isArray(answer.guesses) && answer.guesses.length === 1,
      ).length;
      return { correct: firstTry, total: answers.length };
    }
  }
}

// Awarded once per accepted run and added to the player's lifetime XP inside the
// completeRun transaction. Quarantined runs earn nothing.
export function runXp(
  mode: GameMode,
  score: number,
  transcript: RunTranscript,
): number {
  const { correct, total } = correctness(mode, score, transcript);
  if (total <= 0) return 1;
  const accuracy = Math.min(1, Math.max(0, correct / total));
  const weight = MODE_WEIGHT[mode] ?? DEFAULT_WEIGHT;
  // Accuracy scales the award between half (sloppy) and full (clean); every
  // accepted run earns at least the participation floor.
  return Math.max(1, Math.round(correct * weight * (0.5 + 0.5 * accuracy)));
}
