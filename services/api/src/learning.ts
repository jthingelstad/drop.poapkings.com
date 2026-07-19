import { cardElixir } from "./scoring.js";
import type { RunChallenge, RunTranscript } from "./types.js";

// Server-owned learning telemetry, derived from validated run transcripts at
// completion time. The browser never uploads stats — the server already holds
// every guess it accepted, so it aggregates per-card recall itself and uses it
// to deal weakness-focused Practice challenges.

export interface CardStat {
  seen: number;
  correct: number;
  missStreak: number;
  lastSeenAt: string;
}

export type CardStatsMap = Record<string, CardStat>;

interface CardResult {
  cardId: number;
  correct: boolean;
}

function answerArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

// Extract per-card recall outcomes from a transcript the scorer has already
// validated. Only the single-card cost/name recall modes carry a clean signal;
// relational modes (Higher/Lower, Trade, ladders, Sweep) are skipped.
export function cardResultsFromTranscript(
  challenge: RunChallenge,
  transcript: RunTranscript,
): CardResult[] {
  switch (challenge.mode) {
    case "practice":
      return answerArray(transcript.answers).flatMap((answer) => {
        const cardId = Number(answer.cardId);
        const elixir = cardElixir(cardId);
        return elixir === undefined
          ? []
          : [{ cardId, correct: answer.guess === elixir }];
      });
    case "surge":
    case "identify":
    case "blitz":
      return answerArray(transcript.answers).flatMap((answer) => {
        const cardId = Number(answer.cardId);
        if (cardElixir(cardId) === undefined) return [];
        const guesses = Array.isArray(answer.guesses) ? answer.guesses : [];
        return [{ cardId, correct: guesses.length === 1 }];
      });
    case "survival":
      return answerArray(transcript.answers).flatMap((answer) => {
        const cardId = Number(answer.cardId);
        const elixir = cardElixir(cardId);
        return elixir === undefined
          ? []
          : [
              {
                cardId,
                correct:
                  answer.guess === elixir && Number(answer.elapsedMs) <= 5_000,
              },
            ];
      });
    default:
      return [];
  }
}

export function mergeCardStats(
  existing: CardStatsMap,
  results: CardResult[],
  at: string,
): CardStatsMap {
  const merged: CardStatsMap = { ...existing };
  for (const result of results) {
    const key = String(result.cardId);
    const previous = merged[key];
    merged[key] = {
      seen: (previous?.seen ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (result.correct ? 1 : 0),
      missStreak: result.correct ? 0 : (previous?.missStreak ?? 0) + 1,
      lastSeenAt: at,
    };
  }
  return merged;
}

// Cards worth drilling: an active miss streak, or seen-enough accuracy under
// 75%. Ordered worst-first so Practice seeds from the biggest gaps.
export function weakCardIds(stats: CardStatsMap, limit: number): number[] {
  return Object.entries(stats)
    .map(([key, stat]) => ({ cardId: Number(key), stat }))
    .filter(({ cardId, stat }) => {
      if (cardElixir(cardId) === undefined) return false;
      if (stat.missStreak > 0) return true;
      return stat.seen >= 3 && stat.correct / stat.seen < 0.75;
    })
    .sort((left, right) => {
      const streak = right.stat.missStreak - left.stat.missStreak;
      if (streak) return streak;
      const accuracy =
        left.stat.correct / left.stat.seen -
        right.stat.correct / right.stat.seen;
      if (accuracy) return accuracy;
      return left.stat.seen - right.stat.seen;
    })
    .slice(0, limit)
    .map(({ cardId }) => cardId);
}

// Compact per-cost accuracy summary for the profile/home coaching surfaces.
export function costAccuracy(
  stats: CardStatsMap,
): Record<string, { seen: number; correct: number }> {
  const byCost: Record<string, { seen: number; correct: number }> = {};
  for (const [key, stat] of Object.entries(stats)) {
    const elixir = cardElixir(Number(key));
    if (elixir === undefined) continue;
    const bucket = (byCost[String(elixir)] ??= { seen: 0, correct: 0 });
    bucket.seen += stat.seen;
    bucket.correct += stat.correct;
  }
  return byCost;
}
