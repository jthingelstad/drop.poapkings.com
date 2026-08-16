import {
  TRADE_LADDER,
  type GameMode,
  type PracticeKind,
  type RunChallenge,
  type TradeBoard,
} from "./index.js";

export interface ChallengeCard {
  id: number;
  elixir: number;
}

export type RandomInt = (upperBound: number) => number;

export const SURGE_CARD_COUNT = 15;
export const HIGHER_LOWER_PAIR_COUNT = 250;
export const RAIN_DECK_SIZE = 250;

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
  pool: readonly ChallengeCard[],
): number[] {
  const result: number[] = [];
  while (result.length < count) {
    const next = shuffle(pool, randomInt);
    // No back-to-back repeats across shuffle boundaries: the same card twice
    // in a row reads as a bug, regardless of whether the deal is online or local.
    if (pool.length > 1 && next[0]!.id === result.at(-1)) {
      const swapIndex = 1 + randomInt(next.length - 1);
      [next[0], next[swapIndex]] = [next[swapIndex]!, next[0]!];
    }
    result.push(...next.map((card) => card.id));
  }
  return result.slice(0, count);
}

// The signed keypad answers -4 through +4, so a board whose swing falls outside
// that is unanswerable. Keep the deal bounded so a bad catalog fails loudly.
const TRADE_VALUE_LIMIT = 4;
const TRADE_DEAL_ATTEMPTS = 200;

function tradeBoard(
  board: TradeBoard,
  available: readonly ChallengeCard[],
  randomInt: RandomInt,
): { blue: ChallengeCard[]; red: ChallengeCard[] } | undefined {
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

export function tradeRounds(
  randomInt: RandomInt,
  pool: readonly ChallengeCard[],
): Array<{ blueIds: number[]; redIds: number[] }> {
  const rounds: Array<{ blueIds: number[]; redIds: number[] }> = [];
  let excluded = new Set<number>();
  for (const board of TRADE_LADDER) {
    const size = board.blue + board.red;
    // Cards do not repeat within a run while the catalog can afford it.
    if (pool.length - excluded.size < size) excluded = new Set();
    const available = pool.filter((card) => !excluded.has(card.id));
    const dealt = tradeBoard(board, available, randomInt);
    if (!dealt) {
      throw new Error(
        `Trade could not deal a ${board.blue}v${board.red} board within the signed keypad's range`,
      );
    }
    rounds.push({
      blueIds: dealt.blue.map((card) => card.id),
      redIds: dealt.red.map((card) => card.id),
    });
    for (const card of [...dealt.blue, ...dealt.red]) excluded.add(card.id);
  }
  return rounds;
}

// Higher/Lower's deal and response clock both ramp. These values keep the
// opening readable, then blend down to the hardest one-elixir gap.
const HIGHER_LOWER_GAP_MAX = 4;
const HIGHER_LOWER_GAP_MIN = 1;
const HIGHER_LOWER_GAP_HOLD_ROUNDS = 5;
const HIGHER_LOWER_GAP_RAMP_ROUNDS = 13;

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
  combinations: number;
}

function higherLowerBands(
  byCost: Map<number, ChallengeCard[]>,
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
  for (
    let band = HIGHER_LOWER_GAP_MIN;
    band <= HIGHER_LOWER_GAP_MAX;
    band += 1
  ) {
    let entries = raw.get(band) ?? [];
    for (
      let wider = band + 1;
      !entries.length && wider <= HIGHER_LOWER_GAP_MAX;
    ) {
      entries = raw.get(wider) ?? [];
      wider += 1;
    }
    for (
      let narrower = band - 1;
      !entries.length && narrower >= 1;
      narrower -= 1
    ) {
      entries = raw.get(narrower) ?? [];
    }
    resolved.set(band, entries);
  }
  return resolved;
}

function pickCostPair(
  options: readonly CostPair[],
  randomInt: RandomInt,
): CostPair {
  const total = options.reduce((sum, option) => sum + option.combinations, 0);
  let roll = randomInt(total);
  for (const option of options) {
    roll -= option.combinations;
    if (roll < 0) return option;
  }
  return options.at(-1)!;
}

function pickFromCost(
  options: readonly ChallengeCard[],
  previous: ReadonlySet<number>,
  randomInt: RandomInt,
): ChallengeCard {
  const fresh = options.filter((card) => !previous.has(card.id));
  const choices = fresh.length ? fresh : options;
  return choices[randomInt(choices.length)]!;
}

function higherLowerPairs(
  randomInt: RandomInt,
  pool: readonly ChallengeCard[],
): Array<[number, number]> {
  if (pool.length < 2 || new Set(pool.map((card) => card.elixir)).size < 2) {
    throw new Error("Higher / Lower needs at least two distinct card costs");
  }
  const byCost = new Map<number, ChallengeCard[]>();
  for (const card of pool) {
    const cards = byCost.get(card.elixir) ?? [];
    cards.push(card);
    byCost.set(card.elixir, cards);
  }
  const bands = higherLowerBands(byCost);
  const pairs: Array<[number, number]> = [];
  let previous = new Set<number>();
  for (let round = 0; round < HIGHER_LOWER_PAIR_COUNT; round += 1) {
    const band = bands.get(higherLowerGap(round, randomInt)) ?? [];
    if (!band.length)
      throw new Error("Higher / Lower could not deal a valid cost pair");
    const fresh = band.filter(
      (option) =>
        byCost.get(option.low)!.some((card) => !previous.has(card.id)) &&
        byCost.get(option.high)!.some((card) => !previous.has(card.id)),
    );
    const { low, high } = pickCostPair(fresh.length ? fresh : band, randomInt);
    const lower = pickFromCost(byCost.get(low)!, previous, randomInt);
    const higher = pickFromCost(byCost.get(high)!, previous, randomInt);
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
  pool: readonly ChallengeCard[],
  options?: { practiceKind?: PracticeKind },
): Extract<RunChallenge, { mode: T }>;
export function createChallenge(
  mode: GameMode,
  randomInt: RandomInt,
  pool: readonly ChallengeCard[],
  options?: { practiceKind?: PracticeKind },
): RunChallenge {
  if (!pool.length) throw new Error("A game challenge needs at least one card");
  switch (mode) {
    case "surge":
      return { mode, cardIds: cardSequence(SURGE_CARD_COUNT, randomInt, pool) };
    case "practice":
      return {
        mode,
        practiceKind: options?.practiceKind ?? "costs",
        cardIds: shuffle(pool, randomInt).map((card) => card.id),
      };
    case "survival":
      return { mode, cardIds: shuffle(pool, randomInt).map((card) => card.id) };
    case "rain":
      return { mode, cardIds: cardSequence(RAIN_DECK_SIZE, randomInt, pool) };
    case "higher-lower":
      return { mode, pairs: higherLowerPairs(randomInt, pool) };
    case "trade":
      return { mode, rounds: tradeRounds(randomInt, pool) };
  }
}
