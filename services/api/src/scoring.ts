import rawCards from "@elixir-drop/game-data/cards.json";
import {
  higherLowerWindowMs,
  survivalWindowMs,
  TRADE_LADDER,
  type TradeBoard,
} from "@elixir-drop/contracts";
import type {
  GameMode,
  RunChallenge,
  RunTiebreaks,
  RunTranscript,
} from "./types.js";

interface Card {
  id: number;
  name: string;
  elixir: number;
}

interface CardData {
  cards: Card[];
}

const CARDS = (rawCards as CardData).cards;
const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

// Version of the scoring + integrity rules. Bump whenever the logic in this
// file or integrity.ts changes so historical referee evidence stays
// interpretable across builds that did not change the rules. Stamped onto every
// evidence item alongside the front-end build sha (WEB_VERSION).
export const SCORING_RULES_VERSION = "4";

export function cardElixir(id: number): number | undefined {
  return CARD_BY_ID.get(id)?.elixir;
}
export const SURGE_CARD_COUNT = 15;
export const SURGE_PENALTY_MS = 2_000;
const HIGHER_LOWER_PAIR_COUNT = 250;
// Higher/Lower runs on three lives, like Rain: a wrong tap OR a timeout costs
// one and the run continues, so a transcript legitimately carries misses and
// the score is the TOTAL correct reads, not the longest unbroken streak.
const HIGHER_LOWER_LIVES = 3;
export const RAIN_DECK_SIZE = 250;
export const RAIN_LIVES = 3;
// Rain is endless: the client wraps the signed deck, so a strong run resolves
// more cards than the deck holds. This is an anti-abuse ceiling on transcript
// length (bounds the scorer's work), NOT a game limit — it sits far above any
// reachable score, so no genuine run can hit it. Difficulty walls real players
// out in the low hundreds long before this.
export const RAIN_MAX_ANSWERS = 10_000;
// Practice is endless too (see scorePractice): same anti-abuse ceiling, same
// reasoning — it bounds the scorer, it is not a round length.
export const PRACTICE_MAX_ANSWERS = 10_000;

type RandomInt = (upperBound: number) => number;

// Reflex modes expect fast mash-taps, so a lone sub-100ms answer is human, not a
// bot. Reject a run only when lightning taps are BOTH several and a large share
// of the score — the signature of automation, not an occasional lucky tap.
function isImplausiblyFast(lightningTaps: number, score: number): boolean {
  return lightningTaps >= 3 && lightningTaps > score * 0.25;
}

function shuffle<T>(values: readonly T[], randomInt: RandomInt): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function cardSequence(
  count: number,
  randomInt: RandomInt,
  pool: readonly Card[],
): number[] {
  const result: number[] = [];
  while (result.length < count) {
    const next = shuffle(pool, randomInt);
    // No back-to-back repeats across shuffle boundaries: the same card twice
    // in a row reads as a bug, and in Higher/Lower a boundary repeat dealt a
    // "Knight vs Knight" pair.
    if (pool.length > 1 && next[0]!.id === result.at(-1)) {
      const swapIndex = 1 + randomInt(next.length - 1);
      [next[0], next[swapIndex]] = [next[swapIndex]!, next[0]!];
    }
    result.push(...next.map((card) => card.id));
  }
  return result.slice(0, count);
}

// The signed keypad answers -4 through +4, so a board whose swing falls outside
// that is unanswerable. Card costs are drawn, not chosen, so the in-range board
// is found by rejection: deal the shape, keep it if it lands, redeal if not.
const TRADE_VALUE_LIMIT = 4;
// A bound on that rejection loop. The tightest shapes on this ladder (2v3, 3v2)
// land in range better than half the time, so 200 redeals is beyond
// astronomically safe for the real catalog — it exists so a shape that CANNOT
// land (a catalog of nothing but 9-cost cards, say) fails the run start loudly
// instead of spinning the Lambda forever.
const TRADE_DEAL_ATTEMPTS = 200;

// Deal one exchange of the requested shape from `available`, or undefined when
// the attempt budget runs out. A longer side carries more elixir on average, so
// a lopsided board lands in range mostly when its short side holds the pricier
// card — which is the classic trade read, not a distortion.
function tradeBoard(
  board: TradeBoard,
  available: readonly Card[],
  randomInt: RandomInt,
): { blue: Card[]; red: Card[] } | undefined {
  for (let attempt = 0; attempt < TRADE_DEAL_ATTEMPTS; attempt += 1) {
    const cards = shuffle(available, randomInt);
    const blue = cards.slice(0, board.blue);
    const red = cards.slice(board.blue, board.blue + board.red);
    const value =
      red.reduce((sum, card) => sum + card.elixir, 0) -
      blue.reduce((sum, card) => sum + card.elixir, 0);
    if (Math.abs(value) <= TRADE_VALUE_LIMIT) return { blue, red };
  }
  return undefined;
}

// Trade's exchanges, one per rung of the fixed TRADE_LADDER. The ladder is the
// difficulty ramp and it is deterministic — every run climbs the same board
// shapes in the same order, and only the cards vary. (The old deal rolled both
// side sizes at random and sorted by total card count, which put a two-card
// board in round 1 about 81% of the time but reached 3v3 by round 8 with no run
// of plain 1v1 reads to learn on first.)
export function tradeRounds(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<{ blueIds: number[]; redIds: number[] }> {
  const rounds: Array<{ blueIds: number[]; redIds: number[] }> = [];
  let excluded = new Set<number>();
  for (const board of TRADE_LADDER) {
    const size = board.blue + board.red;
    // Cards do not repeat within a run while the catalog can afford it.
    if (pool.length - excluded.size < size) excluded = new Set();
    const available = pool.filter((card) => !excluded.has(card.id));
    const dealt = tradeBoard(board, available, randomInt);
    if (!dealt)
      throw new Error(
        `Trade could not deal a ${board.blue}v${board.red} board within the signed keypad's range`,
      );
    rounds.push({
      blueIds: dealt.blue.map((card) => card.id),
      redIds: dealt.red.map((card) => card.id),
    });
    for (const card of [...dealt.blue, ...dealt.red]) excluded.add(card.id);
  }
  return rounds;
}

// ── Higher/Lower difficulty ────────────────────────────────────────────────
// The response clock (higherLowerWindowMs) is the KNOWN axis and is deliberately
// untouched. The elixir GAP between the two cards is the axis that ramps: a
// 4-elixir gap reads at a glance, a 1-elixir gap is the hardest call the mode
// can ask for, and a uniformly random draw made the hardest kind of pair the
// single most common opening.
const HIGHER_LOWER_GAP_MAX = 4;
const HIGHER_LOWER_GAP_MIN = 1;
// Opening rounds held fully wide, then the rounds spent narrowing to a 1-elixir
// call. The ramp has to live where the runs live — most end inside the first ten
// rounds — so it is measured in rounds, not in fractions of the 250-pair deck.
const HIGHER_LOWER_GAP_HOLD_ROUNDS = 5;
const HIGHER_LOWER_GAP_RAMP_ROUNDS = 13;

// The elixir gap round `round` should span — a pure function of the round index,
// where the top value means "HIGHER_LOWER_GAP_MAX or wider". The target narrows
// continuously and the fractional part is spent as a weighted coin flip between
// the two neighbouring gaps, so the bands BLEND: round 10 deals a mix of 2s and
// 3s instead of the whole game stepping down a stair on one fixed round.
export function higherLowerGap(round: number, randomInt: RandomInt): number {
  const progress = Math.min(
    1,
    Math.max(
      0,
      (round - HIGHER_LOWER_GAP_HOLD_ROUNDS) / HIGHER_LOWER_GAP_RAMP_ROUNDS,
    ),
  );
  const target =
    HIGHER_LOWER_GAP_MAX -
    (HIGHER_LOWER_GAP_MAX - HIGHER_LOWER_GAP_MIN) * progress;
  const narrower = Math.floor(target);
  const widerOdds = Math.round((target - narrower) * 100);
  return randomInt(100) < widerOdds ? narrower + 1 : narrower;
}

interface CostPair {
  low: number;
  high: number;
  // How many distinct card pairings these two costs can produce.
  combinations: number;
}

// Every dealable cost pair, grouped by the gap band it belongs to (everything
// at or above HIGHER_LOWER_GAP_MAX collapses into the top band — past 4 elixir
// the read is equally free). Bands are resolved outward when the catalog cannot
// make the requested gap: WIDER first, because a wider gap is strictly easier,
// so degrading never hands the player a harder pair than the ramp asked for.
function higherLowerBands(
  byCost: Map<number, Card[]>,
): Map<number, CostPair[]> {
  const costs = [...byCost.keys()].sort((left, right) => left - right);
  const raw = new Map<number, CostPair[]>();
  for (const low of costs) {
    for (const high of costs) {
      if (high <= low) continue;
      const band = Math.min(high - low, HIGHER_LOWER_GAP_MAX);
      const entries = raw.get(band) ?? [];
      entries.push({
        low,
        high,
        combinations: byCost.get(low)!.length * byCost.get(high)!.length,
      });
      raw.set(band, entries);
    }
  }
  const resolved = new Map<number, CostPair[]>();
  for (let band = HIGHER_LOWER_GAP_MIN; band <= HIGHER_LOWER_GAP_MAX; band++) {
    let entries = raw.get(band) ?? [];
    for (
      let wider = band + 1;
      !entries.length && wider <= HIGHER_LOWER_GAP_MAX;
    )
      entries = raw.get(wider++) ?? [];
    for (let narrower = band - 1; !entries.length && narrower >= 1;)
      entries = raw.get(narrower--) ?? [];
    resolved.set(band, entries);
  }
  return resolved;
}

// Cost counts are wildly uneven (34 four-cost cards; exactly one 8 and one 9),
// so a band picks its cost pair weighted by how many CARD pairings it can make.
// Picking cost pairs uniformly would put Golem and Three Musketeers in a large
// share of every wide opening.
function pickCostPair(options: readonly CostPair[], randomInt: RandomInt) {
  const total = options.reduce((sum, option) => sum + option.combinations, 0);
  let roll = randomInt(total);
  for (const option of options) {
    roll -= option.combinations;
    if (roll < 0) return option;
  }
  return options.at(-1)!;
}

// Prefer a card that was not in the previous pair — an immediate repeat reads as
// a bug — but degrade instead of looping: a cost with exactly one card makes
// "avoid the previous card" occasionally impossible.
function pickFromCost(
  options: readonly Card[],
  previous: ReadonlySet<number>,
  randomInt: RandomInt,
): Card {
  const fresh = options.filter((card) => !previous.has(card.id));
  const choices = fresh.length ? fresh : options;
  return choices[randomInt(choices.length)]!;
}

// Independent pairs for the tap-the-higher-card game. Each pair's two cards
// always differ in elixir (never equal, so there is always a strictly higher
// card), neither card repeats from the immediately previous pair, and the gap
// between them narrows as the deck goes on. The target COST PAIR is chosen
// first and the cards second, so a wide gap is never blocked by how few cards
// happen to sit at the far end of the catalog.
function higherLowerPairs(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<[number, number]> {
  const hasTwoCosts = new Set(pool.map((card) => card.elixir)).size >= 2;
  const source = pool.length >= 2 && hasTwoCosts ? pool : CARDS;
  const byCost = new Map<number, Card[]>();
  for (const card of source) {
    const cards = byCost.get(card.elixir) ?? [];
    cards.push(card);
    byCost.set(card.elixir, cards);
  }
  const bands = higherLowerBands(byCost);
  const pairs: Array<[number, number]> = [];
  let previous = new Set<number>();
  for (let round = 0; round < HIGHER_LOWER_PAIR_COUNT; round += 1) {
    const band = bands.get(higherLowerGap(round, randomInt)) ?? [];
    // Unreachable: `source` always holds at least two distinct costs, so every
    // band resolves to something. The guard keeps the loop total anyway.
    if (!band.length) break;
    // Drop the cost pairs that could only repeat a card from the last pair,
    // which is what makes the no-repeat rule exact instead of a retry loop.
    const fresh = band.filter(
      (option) =>
        byCost.get(option.low)!.some((card) => !previous.has(card.id)) &&
        byCost.get(option.high)!.some((card) => !previous.has(card.id)),
    );
    const { low, high } = pickCostPair(fresh.length ? fresh : band, randomInt);
    const lower = pickFromCost(byCost.get(low)!, previous, randomInt);
    const higher = pickFromCost(byCost.get(high)!, previous, randomInt);
    // Flip which side holds the higher card, or the answer is always the same tap.
    const pair: [number, number] =
      randomInt(2) === 0 ? [lower.id, higher.id] : [higher.id, lower.id];
    pairs.push(pair);
    previous = new Set(pair);
  }
  return pairs;
}

export function createChallenge<T extends GameMode>(
  mode: T,
  randomInt: RandomInt,
): Extract<RunChallenge, { mode: T }>;
export function createChallenge(
  mode: GameMode,
  randomInt: RandomInt,
): RunChallenge {
  // Every run draws from the same canonical catalog. Clash Royale collection
  // snapshots remain available on player profiles but do not affect games.
  const pool = CARDS;
  switch (mode) {
    case "surge":
      return { mode, cardIds: cardSequence(15, randomInt, pool) };
    case "practice":
      // Practice is an endless drill, so the signed deck is a POOL, not a
      // sequence: the whole shuffled catalog, from which the client draws in its
      // own weakness-weighted order (and may repeat a card). Unlike Survival the
      // deck length is not the game length — scorePractice validates by set
      // membership, not by position.
      return { mode, cardIds: shuffle(pool, randomInt).map((card) => card.id) };
    case "survival":
      // Every card once, shuffled: clearing the whole deck is a WIN, then it is
      // a race on cumulative time. No repeats, so the max streak is the catalog
      // size (~120).
      return { mode, cardIds: shuffle(pool, randomInt).map((card) => card.id) };
    case "rain":
      // A long draw deck of falling cards. The client spawns tiles from it in
      // order and WRAPS when it runs out (Rain is endless), so a deep run
      // resolves more cards than the deck holds. The signed deck is the set of
      // ids the scorer validates each transcript entry against — not a length
      // limit (see scoreRain / RAIN_MAX_ANSWERS).
      return { mode, cardIds: cardSequence(RAIN_DECK_SIZE, randomInt, pool) };
    case "higher-lower":
      return { mode, pairs: higherLowerPairs(randomInt, pool) };
    case "trade":
      return { mode, rounds: tradeRounds(randomInt, pool) };
  }
}

function objectArray(
  value: unknown,
  label: string,
): Array<Record<string, unknown>> {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  ) {
    throw new Error(`${label} transcript is invalid`);
  }
  return value as Array<Record<string, unknown>>;
}

function numberArray(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isSafeInteger(item))
  )
    throw new Error(`${label} is invalid`);
  return value as number[];
}

function card(id: number): Card {
  const result = CARD_BY_ID.get(id);
  if (!result) throw new Error("Challenge contains an unknown card");
  return result;
}

export type ScoringReviewSignal =
  | "answer_timestamps_not_increasing"
  | "answer_timing_implausibly_fast"
  | "end_time_outside_wall_clock"
  | "higher_lower_no_terminal_event"
  | "higher_lower_timing_implausibly_fast"
  | "higher_lower_time_outside_wall_clock"
  | "survival_no_terminal_event"
  | "survival_timing_implausibly_fast"
  | "survival_time_outside_wall_clock";

export interface ScoredRunWithSignals {
  score: number;
  reviewSignals: ScoringReviewSignal[];
}

function flagOrReject(
  reviewSignals: ScoringReviewSignal[] | undefined,
  signal: ScoringReviewSignal,
  strictMessage: string,
): void {
  if (!reviewSignals) throw new Error(strictMessage);
  if (!reviewSignals.includes(signal)) reviewSignals.push(signal);
}

function verifyPlausibleEnd(
  atMs: number,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): void {
  if (!Number.isFinite(atMs)) throw new Error("Run timing is not plausible");
  if (atMs < 500 || atMs > wallElapsedMs + 2_000)
    flagOrReject(
      reviewSignals,
      "end_time_outside_wall_clock",
      "Run timing is not plausible",
    );
}

function scoreAnswerSprint(
  challenge: number[],
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const answers = objectArray(transcript.answers, "Answer");
  if (answers.length !== challenge.length)
    throw new Error("A complete answer transcript is required");
  let previousAtMs = 0;
  let misses = 0;
  let fastGaps = 0;
  for (let index = 0; index < challenge.length; index += 1) {
    const expectedCardId = challenge[index]!;
    const answer = answers[index]!;
    if (answer.cardId !== expectedCardId)
      throw new Error("Card order does not match the signed run");
    const guesses = numberArray(answer.guesses, "Guesses");
    const atMs = Number(answer.atMs);
    // The guesses cap bounds payload size, not honest play (the client stops
    // recording at the same limit). Timestamps must strictly advance; a sub-79ms
    // gap is a lightning solve — counted, not fatal, so one instant answer in a
    // fast run is fine while a whole run of them (a bot) is caught below.
    if (guesses.length < 1 || guesses.length > 60 || !Number.isFinite(atMs))
      throw new Error("Answer timing is invalid");
    if (atMs <= previousAtMs)
      flagOrReject(
        reviewSignals,
        "answer_timestamps_not_increasing",
        "Answer timing is invalid",
      );
    if (atMs < previousAtMs + 79) fastGaps += 1;
    const correct = card(expectedCardId).elixir;
    if (guesses.at(-1) !== correct || guesses.slice(0, -1).includes(correct))
      throw new Error("Answer sequence is invalid");
    if (guesses.some((guess) => guess < 1 || guess > 10))
      throw new Error("Elixir guess is invalid");
    misses += guesses.length - 1;
    // A client clock anomaly is reviewable, but must not manufacture an
    // artificially low candidate time. Score from the furthest observed time.
    previousAtMs = Math.max(previousAtMs, atMs);
  }
  if (isImplausiblyFast(fastGaps, answers.length))
    flagOrReject(
      reviewSignals,
      "answer_timing_implausibly_fast",
      "Answer timing is implausibly fast",
    );
  verifyPlausibleEnd(previousAtMs, wallElapsedMs, reviewSignals);
  return Math.round(previousAtMs) + misses * SURGE_PENALTY_MS;
}

// Practice: an endless, non-competitive drill. The client re-orders the signed
// deck by the cards the player struggles with and the player stops whenever they
// like, so neither the LENGTH nor the ORDER of the transcript is fixed and the
// same card may legitimately come up more than once. Validation is therefore set
// membership (every answered card must come from the signed deck — the
// anti-injection property) instead of the positional check every other mode
// uses.
//
// That relaxation is safe ONLY because Practice is unranked, earns no Player XP,
// and writes no record: the returned accuracy is a session stat, never a score,
// so there is nothing here worth forging. Do not copy this shape into a mode
// that scores, ranks, or progresses anything.
function scorePractice(
  challenge: Extract<RunChallenge, { mode: "practice" }>,
  transcript: RunTranscript,
): number {
  const answers = objectArray(transcript.answers, "Practice");
  if (!answers.length)
    throw new Error("A Practice session needs at least one answer");
  // Endless, so length is bounded only by an anti-abuse ceiling on the scorer's
  // work — far above any session a human would sit through.
  if (answers.length > PRACTICE_MAX_ANSWERS)
    throw new Error("Practice transcript exceeds the maximum answer count");
  const deck = new Set(challenge.cardIds);
  let correct = 0;
  for (const answer of answers) {
    const cardId = Number(answer.cardId);
    if (!deck.has(cardId))
      throw new Error("Practice card is not from the signed deck");
    if (!Number.isInteger(answer.guess))
      throw new Error("Practice answer is invalid");
    if (answer.guess === card(cardId).elixir) correct += 1;
  }
  return Math.round((correct / answers.length) * 100);
}

interface HigherLowerRound {
  correct: boolean;
  elapsedMs: number;
}

// Validate and grade one Higher/Lower transcript, one entry per pair PRESENTED
// (a miss no longer terminates the transcript — it costs a life and the run
// carries on). Shared by the scorer and the tiebreak reader so the two can
// never disagree about which rounds counted as misses.
function gradeHigherLower(
  challenge: Extract<RunChallenge, { mode: "higher-lower" }>,
  transcript: RunTranscript,
): HigherLowerRound[] {
  const answers = objectArray(transcript.answers, "Higher/Lower");
  if (!answers.length || answers.length > challenge.pairs.length)
    throw new Error("Higher/Lower transcript is invalid");
  const rounds: HigherLowerRound[] = [];
  let livesLost = 0;
  answers.forEach((answer, roundIndex) => {
    // The run is over the moment the third life goes; anything after it is a
    // transcript claiming more failures than the game allows.
    if (livesLost >= HIGHER_LOWER_LIVES)
      throw new Error("Higher/Lower continued past three lives");
    const pair = challenge.pairs[roundIndex]!;
    if (answer.leftId !== pair[0] || answer.rightId !== pair[1])
      throw new Error("Higher/Lower pair is invalid");
    // The player taps the card they read as higher; it must be one of the two.
    const pickedId = answer.pickedId;
    if (pickedId !== pair[0] && pickedId !== pair[1])
      throw new Error("Higher/Lower pick is invalid");
    const elapsedMs = Number(answer.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new Error("Higher/Lower answer is invalid");
    const otherId = pickedId === pair[0] ? pair[1] : pair[0];
    // Pairs are generated with differing elixir, so the higher card is
    // unambiguous (`>=` guards a degenerate equal pair). The response also has
    // to land inside the shrinking window, which is keyed on the ROUND INDEX —
    // every pair presented, missed ones included — because that is the window
    // the client drew. A small tolerance absorbs client timing jitter.
    const correct =
      card(pickedId).elixir >= card(otherId).elixir &&
      elapsedMs <= higherLowerWindowMs(roundIndex) + 250;
    if (!correct) livesLost += 1;
    rounds.push({ correct, elapsedMs });
  });
  return rounds;
}

function scoreHigherLower(
  challenge: Extract<RunChallenge, { mode: "higher-lower" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const rounds = gradeHigherLower(challenge, transcript);
  // Score is every correct read in the session, not the longest unbroken run.
  const score = rounds.filter((round) => round.correct).length;
  const livesLost = rounds.length - score;
  const totalElapsed = rounds.reduce((sum, round) => sum + round.elapsedMs, 0);
  const lightningTaps = rounds.filter(
    (round) => round.correct && round.elapsedMs < 100,
  ).length;
  if (livesLost < HIGHER_LOWER_LIVES && rounds.length < challenge.pairs.length)
    flagOrReject(
      reviewSignals,
      "higher_lower_no_terminal_event",
      "Higher/Lower run has not ended",
    );
  // Only a sustained run of sub-100ms taps raises a review signal — a single
  // human mash-tap must not flag an honest run.
  if (isImplausiblyFast(lightningTaps, score))
    flagOrReject(
      reviewSignals,
      "higher_lower_timing_implausibly_fast",
      "Higher/Lower answers are implausibly fast",
    );
  if (totalElapsed > wallElapsedMs + 2_000)
    flagOrReject(
      reviewSignals,
      "higher_lower_time_outside_wall_clock",
      "Higher/Lower timing is not plausible",
    );
  return score;
}

// Higher/Lower's two ordered leaderboard tiebreaks among equal scores: fewest
// lives lost first, then the faster cumulative time on the clock. The time
// covers EVERY round presented — at an equal score and equal lives lost two
// runs played exactly the same number of rounds, so the comparison is like for
// like, and a fast wrong tap beats burning the whole window on one.
export function higherLowerTiebreaks(
  challenge: RunChallenge,
  transcript: RunTranscript,
): RunTiebreaks | undefined {
  if (challenge.mode !== "higher-lower") return undefined;
  const rounds = gradeHigherLower(challenge, transcript);
  return {
    livesLost: rounds.filter((round) => !round.correct).length,
    timeMs: Math.round(rounds.reduce((sum, round) => sum + round.elapsedMs, 0)),
  };
}

function tradeValue(round: { blueIds: number[]; redIds: number[] }): number {
  return (
    round.redIds.reduce((sum, id) => sum + card(id).elixir, 0) -
    round.blueIds.reduce((sum, id) => sum + card(id).elixir, 0)
  );
}

function scoreTrade(
  challenge: Extract<RunChallenge, { mode: "trade" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const answers = objectArray(transcript.answers, "Trade");
  if (answers.length !== challenge.rounds.length)
    throw new Error("A complete Trade transcript is required");
  let misses = 0;
  let atMs = 0;
  answers.forEach((answer, index) => {
    const guesses = numberArray(answer.guesses, "Trade guesses");
    const expected = tradeValue(challenge.rounds[index]!);
    if (
      !guesses.length ||
      guesses.at(-1) !== expected ||
      guesses.slice(0, -1).includes(expected)
    ) {
      throw new Error("Trade answer sequence is invalid");
    }
    misses += guesses.length - 1;
    atMs = Number(answer.atMs);
  });
  verifyPlausibleEnd(atMs, wallElapsedMs, reviewSignals);
  return Math.round(atMs) + misses * 2_000;
}

function scoreSurvival(
  challenge: Extract<RunChallenge, { mode: "survival" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const answers = objectArray(transcript.answers, "Survival");
  if (!answers.length || answers.length > challenge.cardIds.length)
    throw new Error("Survival transcript is invalid");
  let score = 0;
  let totalElapsed = 0;
  let lightningTaps = 0;
  let ended = false;
  answers.forEach((answer, index) => {
    if (ended) throw new Error("Survival continued after death");
    const cardId = challenge.cardIds[index]!;
    const elapsedMs = Number(answer.elapsedMs);
    if (
      answer.cardId !== cardId ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0
    )
      throw new Error("Survival answer is invalid");
    totalElapsed += elapsedMs;
    // The window tightens with the streak; a small tolerance absorbs client
    // timing jitter on the boundary.
    const correct =
      answer.guess === card(cardId).elixir &&
      elapsedMs <= survivalWindowMs(score) + 250;
    if (correct && elapsedMs < 100) lightningTaps += 1;
    if (correct) score += 1;
    else ended = true;
  });
  if (!ended && answers.length < challenge.cardIds.length)
    flagOrReject(
      reviewSignals,
      "survival_no_terminal_event",
      "Survival run has not ended",
    );
  // A single sub-100ms tap is human mash-timing in a fast reflex game; only a
  // sustained run raises a review signal — one lightning tap must not flag an
  // honest deep run.
  if (isImplausiblyFast(lightningTaps, score))
    flagOrReject(
      reviewSignals,
      "survival_timing_implausibly_fast",
      "Survival answers are implausibly fast",
    );
  if (totalElapsed + score * 200 > wallElapsedMs + 2_000)
    flagOrReject(
      reviewSignals,
      "survival_time_outside_wall_clock",
      "Survival timing is not plausible",
    );
  return score;
}

// Rain: cards fall; the player clears (correctly names the cost of) each lit
// card before it lands, with three lives. The transcript records one entry per
// RESOLVED card in resolution order — { cardId, guess } where guess is the cost
// on a clear and null on a landed (missed) card. Score is the cleared count.
// Card ids are validated against the signed deck (anti-injection); the falling
// timing itself is client-owned (like the other modes' timing), with the run
// capped at three misses.
function scoreRain(
  challenge: Extract<RunChallenge, { mode: "rain" }>,
  transcript: RunTranscript,
): number {
  const answers = objectArray(transcript.answers, "Rain");
  // Endless mode: the client wraps the signed deck, so a deep run legitimately
  // resolves more cards than the deck holds. Card ids are still validated
  // against the signed deck below (anti-injection); only the absolute anti-abuse
  // ceiling bounds length.
  if (answers.length > RAIN_MAX_ANSWERS)
    throw new Error("Rain transcript exceeds the maximum answer count");
  const deck = new Set(challenge.cardIds);
  let cleared = 0;
  let misses = 0;
  for (const answer of answers) {
    if (misses >= RAIN_LIVES)
      throw new Error("Rain continued past three lives");
    const cardId = Number(answer.cardId);
    if (!deck.has(cardId))
      throw new Error("Rain card is not from the signed deck");
    const guess = answer.guess;
    if (guess === null || guess === undefined) {
      misses += 1;
      continue;
    }
    if (Number(guess) === card(cardId).elixir) cleared += 1;
    else misses += 1;
  }
  return cleared;
}

// Cumulative response time across the surviving (correct) Survival cards — the
// leaderboard tiebreak among equal streaks, and the "you cleared it in X" time.
export function survivalTimeMs(
  transcript: RunTranscript,
  score: number,
): number {
  const answers = Array.isArray(transcript.answers) ? transcript.answers : [];
  let total = 0;
  for (let index = 0; index < score && index < answers.length; index += 1) {
    const ms = Number((answers[index] as { elapsedMs?: unknown })?.elapsedMs);
    if (Number.isFinite(ms) && ms > 0) total += ms;
  }
  return Math.round(total);
}

export function scoreRun(
  challenge: RunChallenge,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  switch (challenge.mode) {
    case "surge":
      return scoreAnswerSprint(challenge.cardIds, transcript, wallElapsedMs);
    case "practice":
      return scorePractice(challenge, transcript);
    case "higher-lower":
      return scoreHigherLower(challenge, transcript, wallElapsedMs);
    case "trade":
      return scoreTrade(challenge, transcript, wallElapsedMs);
    case "survival":
      return scoreSurvival(challenge, transcript, wallElapsedMs);
    case "rain":
      return scoreRain(challenge, transcript);
  }
}

// Score all objectively interpretable transcript data while returning the
// assumptions that the strict scorer would have rejected. Ranked completion
// uses this path so those assumptions become an automatic hidden review, not a
// final judgment. Missing or contradictory data that cannot produce a
// comparable score still throws and is retained as unscored evidence.
export function scoreRunWithSignals(
  challenge: RunChallenge,
  transcript: RunTranscript,
  wallElapsedMs: number,
): ScoredRunWithSignals {
  const reviewSignals: ScoringReviewSignal[] = [];
  let score: number;
  switch (challenge.mode) {
    case "surge":
      score = scoreAnswerSprint(
        challenge.cardIds,
        transcript,
        wallElapsedMs,
        reviewSignals,
      );
      break;
    case "practice":
      score = scorePractice(challenge, transcript);
      break;
    case "higher-lower":
      score = scoreHigherLower(
        challenge,
        transcript,
        wallElapsedMs,
        reviewSignals,
      );
      break;
    case "trade":
      score = scoreTrade(challenge, transcript, wallElapsedMs, reviewSignals);
      break;
    case "survival":
      score = scoreSurvival(
        challenge,
        transcript,
        wallElapsedMs,
        reviewSignals,
      );
      break;
    case "rain":
      score = scoreRain(challenge, transcript);
      break;
  }
  return { score, reviewSignals };
}
