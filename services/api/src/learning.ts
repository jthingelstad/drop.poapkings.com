import { cardElixir } from "./scoring.js";
import type { RunChallenge, RunTranscript } from "./types.js";

// Server-owned learning telemetry, derived from validated run transcripts at
// completion time. The browser never uploads stats — the server already holds
// every guess it accepted, so it aggregates per-card recall for possible future
// coaching features. These stats do not affect challenge generation.

export interface CardStat {
  seen: number;
  correct: number;
  missStreak: number;
  lastSeenAt: string;
  // Recall excludes recognition choices and requested hints. Old rows omit
  // these fields, so readers fall back to the lifetime counters above.
  recallSeen?: number;
  recallCorrect?: number;
  assistedSeen?: number;
  assistedCorrect?: number;
  // Average visible response time for unassisted Practice recall only.
  avgMs?: number;
  latencySamples?: number;
}

export type CardStatsMap = Record<string, CardStat>;

interface CardResult {
  cardId: number;
  correct: boolean;
  assisted?: boolean;
  responseMs?: number;
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
// validated. Only the single-card cost recall modes carry a clean signal;
// relational modes (Higher/Lower, Trade) are skipped.
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
          : [
              {
                cardId,
                correct: answer.guess === elixir,
                assisted: answer.assisted === true,
                ...(typeof answer.responseMs === "number"
                  ? { responseMs: answer.responseMs }
                  : {}),
              },
            ];
      });
    case "surge":
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
    const recallSeen = previous?.recallSeen ?? previous?.seen ?? 0;
    const recallCorrect = previous?.recallCorrect ?? previous?.correct ?? 0;
    const assistedSeen = previous?.assistedSeen ?? 0;
    const assistedCorrect = previous?.assistedCorrect ?? 0;
    const latencySamples = previous?.latencySamples ?? 0;
    const recordsRecall = result.assisted !== true;
    const recordsLatency = recordsRecall && result.responseMs !== undefined;
    const nextLatencySamples = latencySamples + (recordsLatency ? 1 : 0);
    const nextAverage = recordsLatency
      ? Math.round(
          ((previous?.avgMs ?? 0) * latencySamples + result.responseMs!) /
            nextLatencySamples,
        )
      : previous?.avgMs;
    merged[key] = {
      seen: (previous?.seen ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (result.correct ? 1 : 0),
      missStreak: result.correct ? 0 : (previous?.missStreak ?? 0) + 1,
      lastSeenAt: at,
      recallSeen: recallSeen + (recordsRecall ? 1 : 0),
      recallCorrect: recallCorrect + (recordsRecall && result.correct ? 1 : 0),
      assistedSeen: assistedSeen + (recordsRecall ? 0 : 1),
      assistedCorrect:
        assistedCorrect + (!recordsRecall && result.correct ? 1 : 0),
      ...(nextAverage === undefined ? {} : { avgMs: nextAverage }),
      ...(nextLatencySamples === 0
        ? {}
        : { latencySamples: nextLatencySamples }),
    };
  }
  return merged;
}

// Cards worth revisiting: an active miss streak, slow fluent recall, or
// seen-enough recall accuracy under 75%. Recognition assistance never inflates
// recall mastery. Ordered worst-first for coaching surfaces.
export function weakCardIds(stats: CardStatsMap, limit: number): number[] {
  return Object.entries(stats)
    .map(([key, stat]) => ({ cardId: Number(key), stat }))
    .filter(({ cardId, stat }) => {
      if (cardElixir(cardId) === undefined) return false;
      if (stat.missStreak > 0) return true;
      const seen = stat.recallSeen ?? stat.seen;
      const correct = stat.recallCorrect ?? stat.correct;
      return (
        (seen >= 3 && correct / seen < 0.75) ||
        ((stat.latencySamples ?? 0) >= 2 && (stat.avgMs ?? 0) >= 3_000)
      );
    })
    .sort((left, right) => {
      const streak = right.stat.missStreak - left.stat.missStreak;
      if (streak) return streak;
      const leftSeen = left.stat.recallSeen ?? left.stat.seen;
      const rightSeen = right.stat.recallSeen ?? right.stat.seen;
      const accuracy =
        (left.stat.recallCorrect ?? left.stat.correct) / leftSeen -
        (right.stat.recallCorrect ?? right.stat.correct) / rightSeen;
      if (accuracy) return accuracy;
      const latency = (right.stat.avgMs ?? 0) - (left.stat.avgMs ?? 0);
      if (latency) return latency;
      return leftSeen - rightSeen;
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
