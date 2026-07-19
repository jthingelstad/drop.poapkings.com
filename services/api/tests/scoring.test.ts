import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import {
  createChallenge,
  scoreRun,
  SURGE_CARD_COUNT,
  survivalTimeMs,
} from "../src/scoring.js";
import { leaderboardPartition, leaderboardSortKey } from "../src/games.js";

const cards = (
  rawCards as { cards: Array<{ id: number; elixir: number }> }
).cards.slice(0, SURGE_CARD_COUNT);
const cardIds = cards.map((card) => card.id);
const allCards = (
  rawCards as { cards: Array<{ id: number; name: string; elixir: number }> }
).cards;
const byId = new Map(allCards.map((card) => [card.id, card]));

function cost(id: number): number {
  return byId.get(id)!.elixir;
}

describe("server-side game scoring", () => {
  it("recomputes Surge elapsed time and wrong-answer penalties", () => {
    const answers = cards.map((card, index) => ({
      cardId: card.id,
      guesses:
        index === 3 ? [card.elixir === 1 ? 2 : 1, card.elixir] : [card.elixir],
      atMs: 1_000 + index * 250,
    }));
    expect(scoreRun({ mode: "surge", cardIds }, { answers }, 10_000)).toBe(
      6_500,
    );
  });

  it("tolerates one lightning solve in Surge but rejects a whole run of them", () => {
    // One sub-79ms gap between solves (an elite burst) — accepted.
    const oneFast = cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: index <= 4 ? 1_000 + index * 800 : 4_250 + (index - 5) * 800,
    }));
    expect(
      scoreRun({ mode: "surge", cardIds }, { answers: oneFast }, 20_000),
    ).toBeGreaterThan(0);

    // Every solve 50ms apart — automation, rejected.
    const allFast = cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: 500 + index * 50,
    }));
    expect(() =>
      scoreRun({ mode: "surge", cardIds }, { answers: allFast }, 20_000),
    ).toThrow(/implausibly fast/);
  });

  it("recomputes Practice accuracy from canonical card costs", () => {
    const answers = cards.map((card, index) => ({
      cardId: card.id,
      guess: index < 12 ? card.elixir : 10,
    }));
    const expectedCorrect = answers.filter(
      (answer, index) => answer.guess === cards[index]?.elixir,
    ).length;
    expect(scoreRun({ mode: "practice", cardIds }, { answers }, 0)).toBe(
      Math.round((expectedCorrect / SURGE_CARD_COUNT) * 100),
    );
  });

  it("ends a Higher/Lower score at the first miss", () => {
    const low = cards.find((card) => card.elixir <= 2) ?? cards[0]!;
    const high = cards.find((card) => card.elixir >= 5) ?? cards.at(-1)!;
    const pairs: Array<[number, number]> = [
      [low.id, high.id],
      [high.id, low.id],
    ];
    const answers = [
      // Taps the higher-cost card in time — correct.
      { leftId: low.id, rightId: high.id, pickedId: high.id, elapsedMs: 800 },
      // Taps the lower-cost card — the miss ends the run.
      { leftId: high.id, rightId: low.id, pickedId: low.id, elapsedMs: 900 },
    ];
    expect(scoreRun({ mode: "higher-lower", pairs }, { answers }, 5_000)).toBe(
      1,
    );
  });

  it("times out a Higher/Lower answer that misses the response window", () => {
    const low = cards.find((card) => card.elixir <= 2) ?? cards[0]!;
    const high = cards.find((card) => card.elixir >= 5) ?? cards.at(-1)!;
    const pairs: Array<[number, number]> = [
      [low.id, high.id],
      [low.id, high.id],
    ];
    // The higher card is tapped, but slower than the 5s opening window (+250ms
    // tolerance): the timeout ends the run at zero.
    const answers = [
      { leftId: low.id, rightId: high.id, pickedId: high.id, elapsedMs: 6_000 },
    ];
    expect(scoreRun({ mode: "higher-lower", pairs }, { answers }, 7_000)).toBe(
      0,
    );
  });

  it("validates Trade transcripts", () => {
    const trade = createChallenge("trade", randomInt);
    const tradeAnswers = trade.rounds.map((round, index) => ({
      guesses: [
        round.redIds.reduce((sum, id) => sum + cost(id), 0) -
          round.blueIds.reduce((sum, id) => sum + cost(id), 0),
      ],
      atMs: 1_000 + index * 100,
    }));
    expect(scoreRun(trade, { answers: tradeAnswers }, 10_000)).toBe(1_700);
  });

  it("validates sudden-death games", () => {
    const survival = createChallenge("survival", randomInt);
    const first = survival.cardIds[0]!;
    const second = survival.cardIds[1]!;
    expect(
      scoreRun(
        survival,
        {
          answers: [
            { cardId: first, guess: cost(first), elapsedMs: 500 },
            {
              cardId: second,
              guess: cost(second) === 1 ? 2 : 1,
              elapsedMs: 500,
            },
          ],
        },
        2_000,
      ),
    ).toBe(1);
  });

  it("puts Survival on a reset board epoch while other modes stay put", () => {
    expect(leaderboardPartition("2026-07", "survival")).toBe(
      "LEADERBOARD#2026-07#survival#r2",
    );
    expect(leaderboardPartition("2026-07", "surge")).toBe(
      "LEADERBOARD#2026-07#surge",
    );
  });

  it("deals Survival as the whole deck once (no repeats) so it can be cleared", () => {
    const survival = createChallenge("survival", randomInt);
    expect(new Set(survival.cardIds).size).toBe(survival.cardIds.length);
    expect(survival.cardIds.length).toBeGreaterThan(100);
  });

  it("sums Survival cumulative time over the surviving cards only", () => {
    const answers = [
      { cardId: 1, guess: 1, elapsedMs: 400 },
      { cardId: 2, guess: 2, elapsedMs: 600 },
      { cardId: 3, guess: 3, elapsedMs: 900 }, // the death card — excluded
    ];
    expect(survivalTimeMs({ answers }, 2)).toBe(1_000);
  });

  it("ranks equal Survival streaks by fastest cumulative time", () => {
    const faster = leaderboardSortKey(
      "survival",
      120,
      "2026-07-19T00:00:00Z",
      "a",
      40_000,
    );
    const slower = leaderboardSortKey(
      "survival",
      120,
      "2026-07-19T00:00:00Z",
      "b",
      55_000,
    );
    // Ascending GSI order → the smaller (faster) key sorts first.
    expect(faster < slower).toBe(true);
    // A higher streak always outranks a lower one regardless of time.
    const deeper = leaderboardSortKey(
      "survival",
      121,
      "2026-07-19T00:00:00Z",
      "c",
      90_000,
    );
    expect(deeper < faster).toBe(true);
  });

  it("tolerates a lone lightning tap but rejects sustained sub-100ms answers", () => {
    const survival = createChallenge("survival", randomInt);
    const ids = survival.cardIds;
    const miss = {
      cardId: ids[6]!,
      guess: cost(ids[6]!) === 1 ? 2 : 1,
      elapsedMs: 500,
    };

    // Six correct with one 50ms mash-tap, then a miss — an honest deep run.
    const honest = [
      ...ids.slice(0, 6).map((id, index) => ({
        cardId: id,
        guess: cost(id),
        elapsedMs: index === 2 ? 50 : 500,
      })),
      miss,
    ];
    expect(scoreRun(survival, { answers: honest }, 30_000)).toBe(6);

    // Every correct answer sub-100ms — the signature of automation.
    const bot = [
      ...ids
        .slice(0, 6)
        .map((id) => ({ cardId: id, guess: cost(id), elapsedMs: 50 })),
      miss,
    ];
    expect(() => scoreRun(survival, { answers: bot }, 30_000)).toThrow(
      /implausibly fast/,
    );
  });

  it("deals Higher/Lower pairs with a strictly higher card (never equal)", () => {
    const challenge = createChallenge("higher-lower", randomInt);
    expect(challenge.pairs.length).toBeGreaterThan(0);
    for (const [a, b] of challenge.pairs) {
      // Two distinct cards whose costs always differ, so tapping "the higher
      // card" is never ambiguous.
      expect(a).not.toBe(b);
      expect(cost(a)).not.toBe(cost(b));
    }
    // No card repeats from the immediately previous pair.
    for (let index = 1; index < challenge.pairs.length; index += 1) {
      const prev = new Set(challenge.pairs[index - 1]!);
      expect(prev.has(challenge.pairs[index]![0])).toBe(false);
      expect(prev.has(challenge.pairs[index]![1])).toBe(false);
    }
  });

  it("tightens the Survival window as the streak grows", () => {
    const survival = createChallenge("survival", randomInt);
    const answers = survival.cardIds.slice(0, 41).map((id, index) => ({
      cardId: id,
      guess: cost(id),
      // Fast until the last answer, which takes 4.9s — fine at streak 0 but
      // far past the tightened window at streak 40.
      elapsedMs: index === 40 ? 4_900 : 300,
    }));
    expect(scoreRun(survival, { answers }, 30_000)).toBe(40);
  });

  it("rejects altered challenge order and implausible clocks", () => {
    const answers = cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: 1_000 + index * 100,
    }));
    answers[0]!.cardId = cards[1]!.id;
    expect(() =>
      scoreRun({ mode: "surge", cardIds }, { answers }, 10_000),
    ).toThrow("order");

    const validAnswers = cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: 5_000 + index * 100,
    }));
    expect(() =>
      scoreRun({ mode: "surge", cardIds }, { answers: validAnswers }, 1_000),
    ).toThrow("plausible");
  });
});
