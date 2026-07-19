import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import {
  collectionPool,
  createChallenge,
  scoreRun,
  SURGE_CARD_COUNT,
} from "../src/scoring.js";

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
      { leftId: low.id, rightId: high.id, choice: "higher" },
      { leftId: high.id, rightId: low.id, choice: "higher" },
    ];
    expect(scoreRun({ mode: "higher-lower", pairs }, { answers }, 0)).toBe(1);
  });

  it("validates Identify and Trade transcripts", () => {
    const identify = createChallenge("identify", randomInt);
    const identifyAnswers = identify.cardIds.map((id, index) => ({
      cardId: id,
      guesses: [id],
      atMs: 1_000 + index * 100,
    }));
    expect(scoreRun(identify, { answers: identifyAnswers }, 10_000)).toBe(
      2_400,
    );

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

  it("validates Ladder and Endless Ladder decisions", () => {
    const ladder = createChallenge("ladder", randomInt);
    const sorted = [...ladder.cardIds].sort(
      (left, right) =>
        cost(left) - cost(right) ||
        byId.get(left)!.name.localeCompare(byId.get(right)!.name),
    );
    expect(
      scoreRun(ladder, { attempts: [{ order: sorted, atMs: 2_000 }] }, 3_000),
    ).toBe(2_000);

    const endless = createChallenge("endless-ladder", randomInt);
    const row = [...endless.startingIds];
    const attempts: Array<{ cardId: number; slotIndex: number }> = [];
    for (const id of endless.cardIds) {
      const validSlot = Array.from(
        { length: row.length + 1 },
        (_, slot) => slot,
      ).find((slot) => {
        const left = row[slot - 1];
        const right = row[slot];
        return (
          (!left || cost(left) <= cost(id)) &&
          (!right || cost(id) <= cost(right))
        );
      });
      const invalidSlot = Array.from(
        { length: row.length + 1 },
        (_, slot) => slot,
      ).find(
        (slot) =>
          slot !== validSlot &&
          !(
            (!row[slot - 1] || cost(row[slot - 1]!) <= cost(id)) &&
            (!row[slot] || cost(id) <= cost(row[slot]!))
          ),
      );
      if (invalidSlot !== undefined) {
        attempts.push({ cardId: id, slotIndex: invalidSlot });
        break;
      }
      if (validSlot === undefined)
        throw new Error("Generated Endless challenge has no valid slot");
      attempts.push({ cardId: id, slotIndex: validSlot });
      row.splice(validSlot, 0, id);
    }
    expect(scoreRun(endless, { attempts }, 0)).toBe(attempts.length - 1);
  });

  it("validates fixed-window and sudden-death games", () => {
    const blitz = createChallenge("blitz", randomInt);
    const blitzAnswers = blitz.cardIds.slice(0, 2).map((id, index) => ({
      cardId: id,
      guesses: [cost(id)],
      atMs: 1_000 + index * 100,
    }));
    expect(scoreRun(blitz, { answers: blitzAnswers }, 60_000)).toBe(2);

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

    const sweep = createChallenge("cost-sweep", randomInt);
    const targetIds = sweep.boards[0]!.cardIds.filter(
      (id) => cost(id) === sweep.boards[0]!.targetElixir,
    );
    const picks = targetIds.map((id, index) => ({
      boardIndex: 0,
      cardId: id,
      atMs: 1_000 + index * 100,
    }));
    expect(scoreRun(sweep, { picks }, 45_000)).toBe(targetIds.length);
  });

  it("accepts an honest Cost Sweep whose window shrank from wrong taps", () => {
    const sweep = createChallenge("cost-sweep", randomInt);
    const board = sweep.boards[0]!;
    const targetIds = board.cardIds.filter(
      (id) => cost(id) === board.targetElixir,
    );
    const wrongIds = board.cardIds
      .filter((id) => cost(id) !== board.targetElixir)
      .slice(0, 3);
    const picks = [
      ...wrongIds.map((id, index) => ({
        boardIndex: 0,
        cardId: id,
        atMs: 500 + index * 200,
      })),
      ...targetIds.map((id, index) => ({
        boardIndex: 0,
        cardId: id,
        atMs: 2_000 + index * 200,
      })),
    ];
    // Three wrong taps shrink the 45s window to 39s of wall time; the old
    // static 43s floor rejected exactly this honest run.
    expect(scoreRun(sweep, { picks }, 39_100)).toBe(targetIds.length);
    // A run that truly ended early is still rejected.
    expect(() => scoreRun(sweep, { picks }, 30_000)).toThrow("too early");
  });

  it("clips answers past the buzzer instead of voiding the run", () => {
    const blitz = createChallenge("blitz", randomInt);
    const answers = blitz.cardIds.slice(0, 3).map((id, index) => ({
      cardId: id,
      guesses: [cost(id)],
      // The third answer lands after the 60s window (a suspended rAF clock).
      atMs: index === 2 ? 61_000 : 1_000 + index * 100,
    }));
    expect(scoreRun(blitz, { answers }, 61_500)).toBe(2);

    const sweep = createChallenge("cost-sweep", randomInt);
    const board = sweep.boards[0]!;
    const targetIds = board.cardIds.filter(
      (id) => cost(id) === board.targetElixir,
    );
    const picks = targetIds.map((id, index) => ({
      boardIndex: 0,
      cardId: id,
      // The final pick lands after the 45s window.
      atMs: index === targetIds.length - 1 ? 46_000 : 1_000 + index * 100,
    }));
    expect(scoreRun(sweep, { picks }, 45_500)).toBe(targetIds.length - 1);
  });

  it("generates a solvable Speed Ladder even from a single-cost collection", () => {
    // All five draws sharing one elixir cost can never be "not ascending";
    // the old unbounded shuffle loop hung the Lambda on this input.
    const sameCost = allCards
      .filter((card) => card.elixir === 4)
      .slice(0, 12)
      .map((card) => card.id);
    const challenge = createChallenge("ladder", randomInt, {
      playerCardIds: sameCost,
    });
    expect(challenge.cardIds).toHaveLength(5);
    expect(new Set(challenge.cardIds.map(cost)).size).toBeGreaterThan(1);
  });

  it("only treats a dozen known cards as a collection pool", () => {
    const dozen = allCards.slice(0, 12).map((card) => card.id);
    expect(collectionPool(dozen)).toHaveLength(12);
    // Too small, unknown ids, or absent → catalog play (ranked).
    expect(collectionPool(dozen.slice(0, 11))).toBeUndefined();
    expect(collectionPool([1, 2, 3])).toBeUndefined();
    expect(collectionPool(undefined)).toBeUndefined();
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
