import rawCards from "@elixir-drop/game-data/cards.json";
import { higherLowerWindowMs, survivalWindowMs } from "@elixir-drop/contracts";
import type { GameMode, RunChallenge, RunTranscript } from "./types.js";

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
export const SCORING_RULES_VERSION = "2";

export function cardElixir(id: number): number | undefined {
  return CARD_BY_ID.get(id)?.elixir;
}
export const SURGE_CARD_COUNT = 15;
export const SURGE_PENALTY_MS = 2_000;
export const HIGHER_LOWER_PAIR_COUNT = 250;
export const RAIN_DECK_SIZE = 250;
export const RAIN_LIVES = 3;

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

function tradeRounds(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<{ blueIds: number[]; redIds: number[] }> {
  const rounds: Array<{ blueIds: number[]; redIds: number[] }> = [];
  let excluded = new Set<number>();
  while (rounds.length < 8) {
    let available = pool.filter((card) => !excluded.has(card.id));
    if (available.length < 6) {
      excluded = new Set();
      available = [...pool];
    }
    const cards = shuffle(available, randomInt);
    const blueCount = randomInt(3) + 1;
    const redCount = randomInt(3) + 1;
    const blue = cards.slice(0, blueCount);
    const red = cards.slice(blueCount, blueCount + redCount);
    const value =
      red.reduce((sum, card) => sum + card.elixir, 0) -
      blue.reduce((sum, card) => sum + card.elixir, 0);
    if (value >= -4 && value <= 4) {
      rounds.push({
        blueIds: blue.map((card) => card.id),
        redIds: red.map((card) => card.id),
      });
      for (const card of [...blue, ...red]) excluded.add(card.id);
    }
  }
  // Ramp the mental load: open with the small exchanges (1v1, 2v1) and close
  // with the big boards, so the run teaches before it tests.
  return rounds.sort(
    (left, right) =>
      left.blueIds.length +
      left.redIds.length -
      (right.blueIds.length + right.redIds.length),
  );
}

// Independent pairs for the tap-the-higher-card game: each pair's two cards
// always differ in elixir (never equal, so there is always a strictly higher
// card), and neither card repeats from the immediately previous pair.
function higherLowerPairs(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<[number, number]> {
  const hasTwoCosts = new Set(pool.map((card) => card.elixir)).size >= 2;
  const source = pool.length >= 2 && hasTwoCosts ? pool : CARDS;
  const pairs: Array<[number, number]> = [];
  let previous = new Set<number>();
  for (let index = 0; index < HIGHER_LOWER_PAIR_COUNT; index += 1) {
    let a = source[randomInt(source.length)]!;
    let b = source[randomInt(source.length)]!;
    for (
      let attempt = 0;
      attempt < 60 &&
      (a.id === b.id ||
        a.elixir === b.elixir ||
        previous.has(a.id) ||
        previous.has(b.id));
      attempt += 1
    ) {
      a = source[randomInt(source.length)]!;
      b = source[randomInt(source.length)]!;
    }
    // Guarantee a strict higher/lower even if a degenerate draw ran out of
    // attempts: swap in the first differing-elixir card.
    if (a.elixir === b.elixir) {
      const alt = source.find((card) => card.elixir !== a.elixir);
      if (alt) b = alt;
    }
    pairs.push([a.id, b.id]);
    previous = new Set([a.id, b.id]);
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
    case "practice":
    case "surge":
      return { mode, cardIds: cardSequence(15, randomInt, pool) };
    case "survival":
      // Every card once, shuffled: clearing the whole deck is a WIN, then it is
      // a race on cumulative time. No repeats, so the max streak is the catalog
      // size (~120).
      return { mode, cardIds: shuffle(pool, randomInt).map((card) => card.id) };
    case "rain":
      // A long draw deck of falling cards. The client spawns tiles from it in
      // order; a deep run rarely exhausts it, and the signed deck is what the
      // scorer validates transcript card ids against.
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

function scorePractice(
  challenge: Extract<RunChallenge, { mode: "practice" }>,
  transcript: RunTranscript,
): number {
  const answers = objectArray(transcript.answers, "Practice");
  if (answers.length !== challenge.cardIds.length)
    throw new Error("A complete Practice round is required");
  let correct = 0;
  answers.forEach((answer, index) => {
    const cardId = challenge.cardIds[index]!;
    if (answer.cardId !== cardId || !Number.isInteger(answer.guess))
      throw new Error("Practice answer is invalid");
    if (answer.guess === card(cardId).elixir) correct += 1;
  });
  return Math.round((correct / answers.length) * 100);
}

function scoreHigherLower(
  challenge: Extract<RunChallenge, { mode: "higher-lower" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const answers = objectArray(transcript.answers, "Higher/Lower");
  if (!answers.length || answers.length > challenge.pairs.length)
    throw new Error("Higher/Lower transcript is invalid");
  let score = 0;
  let totalElapsed = 0;
  let lightningTaps = 0;
  let ended = false;
  answers.forEach((answer, index) => {
    if (ended)
      throw new Error("Higher/Lower transcript continues after a miss");
    const pair = challenge.pairs[index]!;
    if (answer.leftId !== pair[0] || answer.rightId !== pair[1])
      throw new Error("Higher/Lower pair is invalid");
    // The player taps the card they read as higher; it must be one of the two.
    const pickedId = answer.pickedId;
    if (pickedId !== pair[0] && pickedId !== pair[1])
      throw new Error("Higher/Lower pick is invalid");
    const elapsedMs = Number(answer.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new Error("Higher/Lower answer is invalid");
    totalElapsed += elapsedMs;
    const otherId = pickedId === pair[0] ? pair[1] : pair[0];
    // Pairs are generated with differing elixir, so the higher card is
    // unambiguous (`>=` guards a degenerate equal pair). The response also has
    // to land inside the shrinking window; a small tolerance absorbs client
    // timing jitter on the boundary.
    const correct =
      card(pickedId).elixir >= card(otherId).elixir &&
      elapsedMs <= higherLowerWindowMs(score) + 250;
    if (correct && elapsedMs < 100) lightningTaps += 1;
    if (correct) score += 1;
    else ended = true;
  });
  if (!ended && answers.length < challenge.pairs.length)
    flagOrReject(
      reviewSignals,
      "higher_lower_no_terminal_event",
      "Higher/Lower run has not ended",
    );
  // Only a sustained run of sub-100ms taps raises a review signal — a single
  // human mash-tap must not flag an honest streak.
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
  if (answers.length > challenge.cardIds.length)
    throw new Error("Rain transcript is longer than the signed deck");
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
