import { describe, expect, it } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import {
  cardResultsFromTranscript,
  costAccuracy,
  mergeCardStats,
  weakCardIds,
} from "../src/learning.js";

const cards = (rawCards as { cards: Array<{ id: number; elixir: number }> })
  .cards;
const first = cards[0]!;
const second = cards[1]!;
const at = "2026-07-19T12:00:00.000Z";

describe("server-side learning stats", () => {
  it("derives per-card recall from validated transcripts", () => {
    const practice = cardResultsFromTranscript(
      { mode: "practice", cardIds: [first.id, second.id] },
      {
        answers: [
          { cardId: first.id, guess: first.elixir },
          { cardId: second.id, guess: second.elixir === 1 ? 2 : 1 },
        ],
      },
    );
    expect(practice).toEqual([
      { cardId: first.id, correct: true },
      { cardId: second.id, correct: false },
    ]);

    const surge = cardResultsFromTranscript(
      { mode: "surge", cardIds: [first.id] },
      {
        answers: [
          { cardId: first.id, guesses: [3, first.elixir], atMs: 1_000 },
        ],
      },
    );
    // A second guess means the first read failed.
    expect(surge).toEqual([{ cardId: first.id, correct: false }]);

    // Relational modes carry no single-card signal.
    expect(
      cardResultsFromTranscript({ mode: "trade", rounds: [] }, { answers: [] }),
    ).toEqual([]);
  });

  it("merges results and tracks miss streaks", () => {
    const merged = mergeCardStats(
      {
        [String(first.id)]: {
          seen: 2,
          correct: 1,
          missStreak: 1,
          lastSeenAt: at,
        },
      },
      [
        { cardId: first.id, correct: false },
        { cardId: second.id, correct: true },
      ],
      at,
    );
    expect(merged[String(first.id)]).toEqual({
      seen: 3,
      correct: 1,
      missStreak: 2,
      lastSeenAt: at,
    });
    expect(merged[String(second.id)]).toEqual({
      seen: 1,
      correct: 1,
      missStreak: 0,
      lastSeenAt: at,
    });
  });

  it("surfaces the weakest cards worst-first and summarizes cost bands", () => {
    const stats = {
      [String(first.id)]: {
        seen: 5,
        correct: 1,
        missStreak: 3,
        lastSeenAt: at,
      },
      [String(second.id)]: {
        seen: 4,
        correct: 2,
        missStreak: 0,
        lastSeenAt: at,
      },
      [String(cards[2]!.id)]: {
        seen: 6,
        correct: 6,
        missStreak: 0,
        lastSeenAt: at,
      },
      "999999": { seen: 9, correct: 0, missStreak: 9, lastSeenAt: at },
    };
    const weak = weakCardIds(stats, 8);
    // Unknown ids are dropped; the active miss streak leads; mastered cards
    // never appear.
    expect(weak[0]).toBe(first.id);
    expect(weak).toContain(second.id);
    expect(weak).not.toContain(cards[2]!.id);
    expect(weak).not.toContain(999999);

    const byCost = costAccuracy(stats);
    expect(byCost[String(first.elixir)]?.seen).toBeGreaterThanOrEqual(5);
  });
});
