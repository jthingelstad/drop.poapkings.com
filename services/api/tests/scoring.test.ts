import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import rawCards from "@elixir-drop/game-data/cards.json";
import {
  TRADE_LADDER,
  TRADE_ROUNDS,
  type TradeBoard,
} from "@elixir-drop/contracts";
import {
  createChallenge,
  higherLowerGap,
  higherLowerTiebreaks,
  scoreRun,
  scoreRunWithSignals,
  SURGE_CARD_COUNT,
  survivalTimeMs,
  tradeRounds,
} from "../src/scoring.js";
import {
  isLeaderboardEligibleScore,
  leaderboardPartition,
  leaderboardSortKey,
} from "../src/games.js";

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

// ── Higher/Lower fixtures ───────────────────────────────────────────────────
// A run of `count` alternating-side pairs of one cheap and one expensive card,
// plus a transcript builder that says which rounds the player read correctly.
const hlLow = allCards.find((card) => card.elixir <= 2)!;
const hlHigh = allCards.find((card) => card.elixir >= 5)!;

function higherLowerChallenge(count: number) {
  return {
    mode: "higher-lower" as const,
    pairs: Array.from({ length: count }, (_unused, index) =>
      index % 2 === 0
        ? ([hlLow.id, hlHigh.id] as [number, number])
        : ([hlHigh.id, hlLow.id] as [number, number]),
    ),
  };
}

// `reads` is one entry per round presented: true = tapped the higher card.
// `elapsed` overrides the response time for a round, so a round can be failed
// on the clock rather than on the pick.
function higherLowerAnswers(
  challenge: ReturnType<typeof higherLowerChallenge>,
  reads: boolean[],
  elapsed: Record<number, number> = {},
) {
  return reads.map((correct, index) => {
    const pair = challenge.pairs[index]!;
    const higherId = cost(pair[0]) > cost(pair[1]) ? pair[0] : pair[1];
    const lowerId = higherId === pair[0] ? pair[1] : pair[0];
    return {
      leftId: pair[0],
      rightId: pair[1],
      pickedId: correct ? higherId : lowerId,
      elapsedMs: elapsed[index] ?? 800,
    };
  });
}

// ── Trade fixtures ──────────────────────────────────────────────────────────
// One clean guess per exchange of a dealt ladder, 100ms apart.
function tradeAnswers(
  challenge: Extract<ReturnType<typeof createChallenge>, { mode: "trade" }>,
) {
  return challenge.rounds.map((round, index) => ({
    guesses: [
      round.redIds.reduce((sum, id) => sum + cost(id), 0) -
        round.blueIds.reduce((sum, id) => sum + cost(id), 0),
    ],
    atMs: 1_000 + index * 100,
  }));
}

describe("server-side game scoring", () => {
  it("requires a positive score for leaderboard eligibility", () => {
    expect(isLeaderboardEligibleScore(1)).toBe(true);
    expect(isLeaderboardEligibleScore(0)).toBe(false);
    expect(isLeaderboardEligibleScore(-1)).toBe(false);
    expect(isLeaderboardEligibleScore(Number.NaN)).toBe(false);
  });

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

    // Every solve 50ms apart — strict scoring rejects it, while ranked
    // completion retains the deterministic score for referee review.
    const allFast = cards.map((card, index) => ({
      cardId: card.id,
      guesses: [card.elixir],
      atMs: 500 + index * 50,
    }));
    expect(() =>
      scoreRun({ mode: "surge", cardIds }, { answers: allFast }, 20_000),
    ).toThrow(/implausibly fast/);
    expect(
      scoreRunWithSignals(
        { mode: "surge", cardIds },
        { answers: allFast },
        20_000,
      ),
    ).toEqual({
      score: 1_200,
      reviewSignals: ["answer_timing_implausibly_fast"],
    });
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

  // Practice is an endless, unranked drill: the client re-orders the signed deck
  // by the player's weak cards and stops whenever the player does, so the scorer
  // validates set membership rather than position or length.
  it("accepts a Practice transcript of any length, in any order, with repeats", () => {
    const deck = allCards.map((card) => card.id);
    const first = allCards[0]!;
    const last = allCards.at(-1)!;
    // Three answers out of a 120-card deck, out of deck order, one repeated.
    const answers = [
      { cardId: last.id, guess: last.elixir },
      { cardId: first.id, guess: first.elixir },
      { cardId: last.id, guess: last.elixir === 1 ? 2 : 1 },
    ];
    expect(scoreRun({ mode: "practice", cardIds: deck }, { answers }, 0)).toBe(
      67,
    );
  });

  it("rejects a Practice answer for a card outside the signed deck", () => {
    const deck = allCards.slice(0, 10).map((card) => card.id);
    const outsider = allCards.at(-1)!;
    expect(deck).not.toContain(outsider.id);
    expect(() =>
      scoreRun(
        { mode: "practice", cardIds: deck },
        { answers: [{ cardId: outsider.id, guess: outsider.elixir }] },
        0,
      ),
    ).toThrow(/not from the signed deck/);
  });

  it("rejects an empty Practice transcript and a non-integer guess", () => {
    const deck = allCards.map((card) => card.id);
    expect(() =>
      scoreRun({ mode: "practice", cardIds: deck }, { answers: [] }, 0),
    ).toThrow(/needs at least one answer/);
    expect(() =>
      scoreRun(
        { mode: "practice", cardIds: deck },
        { answers: [{ cardId: deck[0]!, guess: "4" }] },
        0,
      ),
    ).toThrow(/Practice answer is invalid/);
  });

  it("counts every correct Higher/Lower read through one and two misses", () => {
    // One miss: the run keeps going and the later reads still score.
    const three = higherLowerChallenge(3);
    expect(
      scoreRun(
        three,
        { answers: higherLowerAnswers(three, [true, false, true]) },
        20_000,
      ),
    ).toBe(2);

    // Two misses: still alive, and the score is the TOTAL correct — not the
    // longest unbroken streak, which would be 2 here.
    const six = higherLowerChallenge(6);
    expect(
      scoreRun(
        six,
        {
          answers: higherLowerAnswers(six, [
            true,
            false,
            true,
            true,
            false,
            true,
          ]),
        },
        20_000,
      ),
    ).toBe(4);
  });

  it("ends a Higher/Lower run on the third miss and rejects a fourth", () => {
    const challenge = higherLowerChallenge(6);
    // Three misses is a complete run: the deck is not exhausted, but the lives
    // are, so no "run has not ended" signal is raised.
    expect(
      scoreRun(
        challenge,
        { answers: higherLowerAnswers(challenge, [true, false, false, false]) },
        20_000,
      ),
    ).toBe(1);

    // A fourth failure is a transcript claiming more misses than the game allows.
    expect(() =>
      scoreRun(
        challenge,
        {
          answers: higherLowerAnswers(challenge, [false, false, false, false]),
        },
        20_000,
      ),
    ).toThrow(/past three lives/);

    // So is any round played after the third life is gone, even a correct one.
    expect(() =>
      scoreRun(
        challenge,
        { answers: higherLowerAnswers(challenge, [false, false, false, true]) },
        20_000,
      ),
    ).toThrow(/past three lives/);
  });

  it("validates each Higher/Lower response against its own round's window", () => {
    const challenge = higherLowerChallenge(6);
    // 4.9s is inside the 5s opening window but far past round 5's 3.75s one, so
    // the same response time passes early and fails late — one life, not the run.
    const answers = higherLowerAnswers(
      challenge,
      [true, true, true, true, true, true],
      { 0: 4_900, 5: 4_900 },
    );
    expect(scoreRun(challenge, { answers }, 40_000)).toBe(5);
  });

  it("returns both Higher/Lower tiebreaks: lives lost, then cumulative time", () => {
    const challenge = higherLowerChallenge(5);
    const answers = higherLowerAnswers(
      challenge,
      [true, false, true, false, true],
      { 0: 500, 1: 1_000, 2: 600, 3: 1_200, 4: 700 },
    );
    expect(higherLowerTiebreaks(challenge, { answers })).toEqual({
      livesLost: 2,
      // Every round presented counts toward the time, misses included.
      timeMs: 4_000,
    });
    // Only Higher/Lower has these; every other mode reads back undefined.
    expect(
      higherLowerTiebreaks({ mode: "surge", cardIds }, { answers: [] }),
    ).toBeUndefined();
  });

  it("ramps the Higher/Lower gap from wide opening pairs to 1-elixir calls", () => {
    // The gap is randomised between the two neighbouring bands, so pin both
    // extremes: () => 0 always rounds up, (n) => n - 1 always rounds down.
    const widest = (round: number) => higherLowerGap(round, () => 0);
    const tightest = (round: number) => higherLowerGap(round, (n) => n - 1);

    // The opening is held fully wide — a 4+ elixir gap reads at a glance.
    for (let round = 0; round <= 5; round += 1) {
      expect(widest(round)).toBe(4);
      expect(tightest(round)).toBe(4);
    }
    // The middle of a run blends 2s and 3s rather than stepping down a stair.
    expect(tightest(10)).toBe(2);
    expect(widest(10)).toBe(3);
    expect(tightest(13)).toBe(2);
    // Deep rounds are the hardest call the mode can ask for, and stay there.
    for (const round of [18, 40, 249]) {
      expect(widest(round)).toBe(1);
      expect(tightest(round)).toBe(1);
    }
    // It never gets easier as the run goes on.
    for (let round = 1; round < 60; round += 1) {
      expect(tightest(round)).toBeLessThanOrEqual(tightest(round - 1));
      expect(widest(round)).toBeLessThanOrEqual(widest(round - 1));
    }
  });

  it("validates Trade transcripts", () => {
    const trade = createChallenge("trade", randomInt);
    expect(trade.rounds).toHaveLength(TRADE_ROUNDS);
    const answers = tradeAnswers(trade);
    // The last answer's atMs is the run time; every round was solved first try.
    expect(scoreRun(trade, { answers }, 10_000)).toBe(1_900);
  });

  it("rejects a Trade transcript that is not the full ladder", () => {
    const trade = createChallenge("trade", randomInt);
    const answers = tradeAnswers(trade);
    // Eight exchanges was the old run length; it is now an incomplete run.
    expect(() =>
      scoreRun(trade, { answers: answers.slice(0, 8) }, 10_000),
    ).toThrow(/complete Trade transcript/);
    expect(() =>
      scoreRun(trade, { answers: [...answers, answers[0]!] }, 10_000),
    ).toThrow(/complete Trade transcript/);
  });

  it("climbs Trade's ladder: three 1v1 openers, then one card at a time", () => {
    expect(TRADE_LADDER).toHaveLength(10);
    const size = (board: TradeBoard) => board.blue + board.red;

    // The first third is the fundamental read: two cards, one subtraction.
    for (const board of TRADE_LADDER.slice(0, 3))
      expect(board).toEqual({ blue: 1, red: 1 });

    // Every side is playable (1-3 cards) and the load never drops back.
    for (const [index, board] of TRADE_LADDER.entries()) {
      for (const count of [board.blue, board.red]) {
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(3);
      }
      if (index > 0)
        expect(size(board)).toBeGreaterThanOrEqual(
          size(TRADE_LADDER[index - 1]!),
        );
    }

    // The full board is the finish line, not the middle of the run.
    const firstFullBoard = TRADE_LADDER.findIndex(
      (board) => board.blue === 3 && board.red === 3,
    );
    expect(firstFullBoard).toBeGreaterThanOrEqual(TRADE_LADDER.length - 2);
    expect(TRADE_LADDER.at(-1)).toEqual({ blue: 3, red: 3 });
  });

  it("deals every Trade board to the ladder, inside the keypad's range", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const trade = createChallenge("trade", randomInt);
      const seen: number[] = [];
      trade.rounds.forEach((round, index) => {
        const board = TRADE_LADDER[index]!;
        expect(round.blueIds).toHaveLength(board.blue);
        expect(round.redIds).toHaveLength(board.red);
        const value =
          round.redIds.reduce((sum, id) => sum + cost(id), 0) -
          round.blueIds.reduce((sum, id) => sum + cost(id), 0);
        // Outside -4..+4 the signed keypad cannot answer the exchange at all.
        expect(value).toBeGreaterThanOrEqual(-4);
        expect(value).toBeLessThanOrEqual(4);
        seen.push(...round.blueIds, ...round.redIds);
      });
      // A card never comes back inside one run — the catalog is far larger than
      // the 38 cards the ladder deals.
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it("fails the deal instead of spinning when a board cannot land in range", () => {
    // A catalog of nothing but 9-cost cards can open (1v1 is a wash) but can
    // never make the 1v2 rung answerable. The bounded redeal has to give up.
    const nines = Array.from({ length: 8 }, (_unused, index) => ({
      id: 900 + index,
      name: `Nine ${index}`,
      elixir: 9,
    }));
    expect(() => tradeRounds(randomInt, nines)).toThrow(/1v2 board/);
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

  it("puts the reworked modes on reset board epochs while others stay put", () => {
    expect(leaderboardPartition("2026-07", "survival")).toBe(
      "LEADERBOARD#2026-07#survival#r2",
    );
    // Rain restarted when its difficulty stopped capping — pre-redesign scores
    // came off an easier game and are retired with the old partition.
    expect(leaderboardPartition("2026-07", "rain")).toBe(
      "LEADERBOARD#2026-07#rain#r2",
    );
    expect(leaderboardPartition("ALLTIME", "rain")).toBe(
      "LEADERBOARD#ALLTIME#rain#r2",
    );
    // Higher/Lower restarted with three lives + the gap ramp: a one-life score
    // measured something else entirely and cannot share a board.
    expect(leaderboardPartition("2026-07", "higher-lower")).toBe(
      "LEADERBOARD#2026-07#higher-lower#r2",
    );
    // Trade restarted at ten exchanges on a fixed ladder: two more exchanges
    // alone make every eight-exchange time unbeatable.
    expect(leaderboardPartition("2026-07", "trade")).toBe(
      "LEADERBOARD#2026-07#trade#r2",
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

  it("scores Rain as cleared cards and caps the run at three misses", () => {
    const rain = createChallenge("rain", randomInt);
    const deck = rain.cardIds;
    const answers = [
      ...Array.from({ length: 5 }, (_unused, i) => ({
        cardId: deck[i]!,
        guess: cost(deck[i]!),
      })),
      { cardId: deck[5]!, guess: null },
      { cardId: deck[6]!, guess: null },
      { cardId: deck[7]!, guess: null },
    ];
    expect(scoreRun(rain, { answers }, 12_000)).toBe(5);
    // A fourth miss is impossible — the run ends when the third life is lost.
    expect(() =>
      scoreRun(
        rain,
        { answers: [...answers, { cardId: deck[8]!, guess: null }] },
        12_000,
      ),
    ).toThrow(/three lives/);
  });

  it("deals Rain as a long draw deck", () => {
    expect(createChallenge("rain", randomInt).cardIds.length).toBe(250);
  });

  it("scores an endless Rain run that outlasts the signed deck (wrapped cards)", () => {
    // Rain wraps the deck client-side, so a deep run resolves more cards than the
    // deck holds. That must score, not trip an integrity error (Tyler's 550-clear
    // run was wrongly rejected as "longer than the signed deck").
    const rain = createChallenge("rain", randomInt);
    const deck = rain.cardIds;
    const cleared = deck.length + 60; // past the 250 deck length
    const answers = [
      ...Array.from({ length: cleared }, (_unused, i) => ({
        cardId: deck[i % deck.length]!,
        guess: cost(deck[i % deck.length]!),
      })),
      { cardId: deck[0]!, guess: null },
      { cardId: deck[1]!, guess: null },
      { cardId: deck[2]!, guess: null },
    ];
    expect(scoreRun(rain, { answers }, 300_000)).toBe(cleared);
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
    expect(challenge.pairs).toHaveLength(250);
    for (const [a, b] of challenge.pairs) {
      // Two distinct cards, both real catalog cards, whose costs always differ —
      // so tapping "the higher card" is never ambiguous.
      expect(a).not.toBe(b);
      expect(byId.has(a)).toBe(true);
      expect(byId.has(b)).toBe(true);
      expect(cost(a)).not.toBe(cost(b));
    }
    // No card repeats from the immediately previous pair.
    for (let index = 1; index < challenge.pairs.length; index += 1) {
      const prev = new Set(challenge.pairs[index - 1]!);
      expect(prev.has(challenge.pairs[index]![0])).toBe(false);
      expect(prev.has(challenge.pairs[index]![1])).toBe(false);
    }
  });

  it("opens Higher/Lower on wide gaps and narrows to 1-elixir calls", () => {
    const gaps = createChallenge("higher-lower", randomInt).pairs.map(
      ([a, b]) => Math.abs(cost(a) - cost(b)),
    );
    // The opening rounds — where 4 in 10 runs used to die — are all readable.
    // The top band is "4 or wider", so an opening pair may be wider still.
    for (const gap of gaps.slice(0, 6)) expect(gap).toBeGreaterThanOrEqual(4);
    // Then it narrows band by band, blending two neighbours at a time.
    for (const gap of gaps.slice(6, 10)) expect(gap).toBeGreaterThanOrEqual(3);
    for (const gap of gaps.slice(10, 14)) expect([2, 3]).toContain(gap);
    for (const gap of gaps.slice(14, 18)) expect([1, 2]).toContain(gap);
    // Past the ramp every pair is the hardest kind of call, for the whole deck.
    for (const gap of gaps.slice(18)) expect(gap).toBe(1);
  });

  it("ranks equal Higher/Lower scores by lives lost, then cumulative time", () => {
    const key = (
      score: number,
      livesLost: number,
      timeMs: number,
      sub: string,
    ) =>
      leaderboardSortKey("higher-lower", score, "2026-07-25T00:00:00Z", sub, [
        livesLost,
        timeMs,
      ]);
    // Ascending GSI order → the smaller key ranks higher.
    // Fewer lives lost wins even when the run took longer.
    expect(key(20, 0, 90_000, "a") < key(20, 1, 30_000, "b")).toBe(true);
    // Same score and same lives lost → the faster run wins.
    expect(key(20, 1, 30_000, "a") < key(20, 1, 45_000, "b")).toBe(true);
    // Score still outranks both tiebreaks.
    expect(key(21, 3, 90_000, "c") < key(20, 0, 1_000, "d")).toBe(true);
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
    expect(
      scoreRunWithSignals(
        { mode: "surge", cardIds },
        { answers: validAnswers },
        1_000,
      ),
    ).toEqual({
      score: 6_400,
      reviewSignals: ["end_time_outside_wall_clock"],
    });
  });
});
