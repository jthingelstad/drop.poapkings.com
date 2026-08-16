import rawCards from "@elixir-drop/game-data/cards.json";
import {
  higherLowerWindowMs,
  LEDGER_MAX_PLAYS,
  LEDGER_MIN_PLAYS,
  LEDGER_VALUE_LIMIT,
  type PracticeKind,
  rainSpawnFloorMs,
  rainSpawnIntervalMs,
  survivalWindowMs,
} from "@elixir-drop/contracts";
import {
  createChallenge as createGameChallenge,
  higherLowerGap,
  SURGE_CARD_COUNT,
  tradeRounds as createTradeRounds,
  type RandomInt,
} from "@elixir-drop/contracts/challenge-generation";
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
export const SCORING_RULES_VERSION = "7";

export function cardElixir(id: number): number | undefined {
  return CARD_BY_ID.get(id)?.elixir;
}
export { higherLowerGap, SURGE_CARD_COUNT };
export const SURGE_PENALTY_MS = 2_000;
// Higher/Lower runs on three lives, like Rain: a wrong tap OR a timeout costs
// one and the run continues, so a transcript legitimately carries misses and
// the score is the TOTAL correct reads, not the longest unbroken streak.
const HIGHER_LOWER_LIVES = 3;
export const RAIN_LIVES = 3;
// Rain is endless: the client wraps the signed deck, so a strong run resolves
// more cards than the deck holds. This is an anti-abuse ceiling on transcript
// length (bounds the scorer's work), NOT a game limit — it sits far above any
// reachable score, so no genuine run can hit it. Difficulty walls real players
// out in the low hundreds long before this.
export const RAIN_MAX_ANSWERS = 10_000;
// Wrong taps one falling card may carry. A wrong tap gives a higher/lower hint
// and does NOT stop the fall, so several on one tile is ordinary play; this
// bounds payload size, not honest play (the client stops counting at the same
// limit). Same shape and same number as Surge's per-card guesses cap.
const RAIN_MAX_WRONG_PER_CARD = 60;
// Slack allowed against Rain's spawn-curve floor before a run is held for
// review. The same 2s this file already allows every other mode's timing, and
// the right size here for three reasons: the floor sums ONE spawn gap more than
// the strictly unavoidable minimum (a player who cleared every tile the instant
// it appeared would still owe the last gap, ≤1,160ms and shrinking with score);
// the wall clock it is checked against also carries the ~1.95s 3-2-1 countdown
// and the round trip, which no in-game timing can spend; and the outcome is
// quarantine rather than rejection, so buying certainty with a larger tolerance
// would only cost the referee the very cases worth looking at.
export const RAIN_FLOOR_TOLERANCE_MS = 2_000;
// Practice is endless too (see scorePractice): same anti-abuse ceiling, same
// reasoning — it bounds the scorer, it is not a round length.
export const PRACTICE_MAX_ANSWERS = 10_000;

// Reflex modes expect fast mash-taps, so a lone sub-100ms answer is human, not a
// bot. Reject a run only when lightning taps are BOTH several and a large share
// of the score — the signature of automation, not an occasional lucky tap.
function isImplausiblyFast(lightningTaps: number, score: number): boolean {
  return lightningTaps >= 3 && lightningTaps > score * 0.25;
}

export function tradeRounds(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<{ blueIds: number[]; redIds: number[] }> {
  return createTradeRounds(randomInt, pool);
}

export function createChallenge<T extends GameMode>(
  mode: T,
  randomInt: RandomInt,
  options?: { practiceKind?: PracticeKind },
): Extract<RunChallenge, { mode: T }>;
export function createChallenge(
  mode: GameMode,
  randomInt: RandomInt,
  options?: { practiceKind?: PracticeKind },
): RunChallenge {
  return createGameChallenge(mode, randomInt, CARDS, options);
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
  | "rain_answers_outrun_spawn_curve"
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

// A review signal that is NEVER a rejection, on either path. Used for Rain's
// spawn-curve floor: the floor is derived from a difficulty model, so a run
// under it is quarantined for a referee and stays fully scored — including on
// the strict (guest) path, where there is nothing to protect but also nothing
// to gain from throwing away a scored game.
function flagForReview(
  reviewSignals: ScoringReviewSignal[] | undefined,
  signal: ScoringReviewSignal,
): void {
  if (reviewSignals && !reviewSignals.includes(signal))
    reviewSignals.push(signal);
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
  if (challenge.practiceKind === "ledger")
    return scoreLedger(challenge, transcript);
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
    if (
      answer.responseMs !== undefined &&
      (typeof answer.responseMs !== "number" ||
        !Number.isInteger(answer.responseMs) ||
        answer.responseMs < 0 ||
        answer.responseMs > 60_000)
    )
      throw new Error("Practice response time is invalid");
    if (answer.assisted !== undefined && typeof answer.assisted !== "boolean")
      throw new Error("Practice assistance is invalid");
    if (answer.guess === card(cardId).elixir) correct += 1;
  }
  return Math.round((correct / answers.length) * 100);
}

// Ledger uses the same endless, unranked Practice channel but a deliberately
// different transcript. Each check repeats the exact play sequence so the
// server can derive the balance from its own catalog, verify every card came
// from the signed pool, and reject a client-authored answer key.
function scoreLedger(
  challenge: Extract<RunChallenge, { mode: "practice" }>,
  transcript: RunTranscript,
): number {
  const answers = objectArray(transcript.answers, "Ledger");
  if (!answers.length)
    throw new Error("A Ledger session needs at least one check");
  if (answers.length > PRACTICE_MAX_ANSWERS)
    throw new Error("Ledger transcript exceeds the maximum check count");
  const deck = new Set(challenge.cardIds);
  const stages = new Set(["guided", "faded", "tracked"]);
  let correct = 0;

  for (const answer of answers) {
    const plays = objectArray(answer.plays, "Ledger plays");
    if (plays.length < LEDGER_MIN_PLAYS || plays.length > LEDGER_MAX_PLAYS)
      throw new Error("Ledger sequence length is invalid");
    const seen = new Set<number>();
    const sides = new Set<string>();
    let balance = 0;
    for (const play of plays) {
      const cardId = Number(play.cardId);
      if (!Number.isSafeInteger(cardId) || !deck.has(cardId))
        throw new Error("Ledger card is not from the signed deck");
      if (seen.has(cardId))
        throw new Error("Ledger cannot repeat a card within one sequence");
      if (play.side !== "blue" && play.side !== "red")
        throw new Error("Ledger side is invalid");
      seen.add(cardId);
      sides.add(play.side);
      const cost = card(cardId).elixir;
      balance += play.side === "red" ? cost : -cost;
    }
    if (sides.size !== 2 || Math.abs(balance) > LEDGER_VALUE_LIMIT)
      throw new Error("Ledger sequence balance is invalid");
    if (
      !Number.isInteger(answer.guess) ||
      Math.abs(Number(answer.guess)) > LEDGER_VALUE_LIMIT
    )
      throw new Error("Ledger answer is invalid");
    if (
      typeof answer.responseMs !== "number" ||
      !Number.isInteger(answer.responseMs) ||
      answer.responseMs < 0 ||
      answer.responseMs > 60_000
    )
      throw new Error("Ledger response time is invalid");
    if (typeof answer.assisted !== "boolean")
      throw new Error("Ledger assistance is invalid");
    if (typeof answer.stage !== "string" || !stages.has(answer.stage))
      throw new Error("Ledger stage is invalid");
    if (answer.guess === balance) correct += 1;
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
    // A round ends either with a tap or on the clock, and the two are distinct
    // on the wire. The client used to synthesize the LOWER card on a timeout so
    // this path would read a miss — which recorded a tap the player never made,
    // blamed that card in the reveal, and left a timeout indistinguishable from
    // a genuine wrong answer here and in the referee evidence.
    const elapsedMs = Number(answer.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new Error("Higher/Lower answer is invalid");
    if (answer.timedOut === true) {
      // Out of time is always a lost life and never a scored read.
      livesLost += 1;
      rounds.push({ correct: false, elapsedMs });
      return;
    }
    // Only a tap carries a pick, and it must be one of the two cards.
    const pickedId = answer.pickedId;
    if (pickedId !== pair[0] && pickedId !== pair[1])
      throw new Error("Higher/Lower pick is invalid");
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

interface RainCard {
  cleared: boolean;
  wrongGuesses: number;
  // How long after this tile could EARLIEST have spawned the player resolved
  // it. Derived here from `atMs` and the shared spawn curve — the client never
  // reports a latency, so there is no separate number to forge: the same stamp
  // that has to clear the floor is the one that ranks the tie.
  latencyMs: number;
}

// Rain: cards fall; the player clears (correctly names the cost of) each lit
// card before it lands, with three lives. The transcript records one entry per
// RESOLVED card in resolution order — { cardId, guess, atMs, wrongGuesses },
// where guess is the cost on a clear and null on a landed (missed) card, atMs is
// the elapsed run time at resolution, and wrongGuesses is how many wrong taps
// that card cost (a wrong tap hints higher/lower and does NOT stop the fall).
// Score is the cleared count. Card ids are validated against the signed deck
// (anti-injection) and the run is capped at three misses.
//
// Shared by the scorer and the tiebreak reader so the two can never disagree
// about what a transcript says.
function gradeRain(
  challenge: Extract<RunChallenge, { mode: "rain" }>,
  transcript: RunTranscript,
  reviewSignals?: ScoringReviewSignal[],
): { cards: RainCard[]; lastAtMs: number } {
  const answers = objectArray(transcript.answers, "Rain");
  // Endless mode: the client wraps the signed deck, so a deep run legitimately
  // resolves more cards than the deck holds. Card ids are still validated
  // against the signed deck below (anti-injection); only the absolute anti-abuse
  // ceiling bounds length.
  if (answers.length > RAIN_MAX_ANSWERS)
    throw new Error("Rain transcript exceeds the maximum answer count");
  const deck = new Set(challenge.cardIds);
  const cards: RainCard[] = [];
  let misses = 0;
  let previousAtMs = 0;
  // rainSpawnFloorMs(index), accumulated as we go rather than re-summed per
  // answer (the ceiling is 10,000 answers, and the quadratic version of this
  // loop would be the slowest thing in the scorer). Same additions in the same
  // order as the exported helper, so rounding it lands on exactly the same
  // millisecond — asserted in mode-curves.test.ts.
  let spawnFloorMs = 0;
  answers.forEach((answer, index) => {
    if (misses >= RAIN_LIVES)
      throw new Error("Rain continued past three lives");
    const cardId = Number(answer.cardId);
    if (!deck.has(cardId))
      throw new Error("Rain card is not from the signed deck");
    const atMs = Number(answer.atMs);
    if (!Number.isFinite(atMs) || atMs < 0)
      throw new Error("Rain answer timing is invalid");
    // Cards resolve in order, so the stamps only move forward. Two tiles CAN
    // land on the same animation tick, so equal stamps are ordinary play and
    // only a backwards one is a broken transcript.
    if (atMs < previousAtMs)
      flagOrReject(
        reviewSignals,
        "answer_timestamps_not_increasing",
        "Rain answer timing is invalid",
      );
    const wrongGuesses =
      answer.wrongGuesses === undefined ? 0 : Number(answer.wrongGuesses);
    if (
      !Number.isSafeInteger(wrongGuesses) ||
      wrongGuesses < 0 ||
      wrongGuesses > RAIN_MAX_WRONG_PER_CARD
    )
      throw new Error("Rain wrong-guess count is invalid");
    // Resolving the (index + 1)-th card means at least index + 1 tiles have
    // spawned, so this answer cannot land before the tile at `index` could —
    // and how far past that it landed is the clear latency.
    const latencyMs = atMs - Math.round(spawnFloorMs);
    if (latencyMs + RAIN_FLOOR_TOLERANCE_MS < 0)
      flagForReview(reviewSignals, "rain_answers_outrun_spawn_curve");
    spawnFloorMs += rainSpawnIntervalMs(index);
    previousAtMs = Math.max(previousAtMs, atMs);
    const guess = answer.guess;
    const cleared =
      guess !== null &&
      guess !== undefined &&
      Number(guess) === card(cardId).elixir;
    if (!cleared) misses += 1;
    cards.push({ cleared, wrongGuesses, latencyMs: Math.max(0, latencyMs) });
  });
  return { cards, lastAtMs: previousAtMs };
}

function scoreRain(
  challenge: Extract<RunChallenge, { mode: "rain" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
  reviewSignals?: ScoringReviewSignal[],
): number {
  const { cards, lastAtMs } = gradeRain(challenge, transcript, reviewSignals);
  const cleared = cards.filter((entry) => entry.cleared).length;
  if (!cards.length) return cleared;
  // The minimum-time floor. Rain has no round length and no clock, so before
  // this its only ceiling was the anti-abuse transcript cap: a list of
  // deck-valid card ids scored ten thousand, instantly and clean. Difficulty is
  // a deterministic function of the cleared count, so the elapsed time behind a
  // score of N is bounded from below by the first N spawn gaps — you cannot
  // clear a tile that has not spawned. A run under that floor is HELD FOR
  // REFEREE REVIEW, never rejected: the floor comes from a difficulty model, and
  // a model is exactly the kind of thing that produces a false positive on an
  // exceptional player.
  if (lastAtMs + RAIN_FLOOR_TOLERANCE_MS < rainSpawnFloorMs(cleared))
    flagForReview(reviewSignals, "rain_answers_outrun_spawn_curve");
  verifyPlausibleEnd(lastAtMs, wallElapsedMs, reviewSignals);
  return cleared;
}

// Rain's two ordered leaderboard tiebreaks among equal cleared counts: fewest
// wrong guesses first, then the lower average clear latency. Wrong guesses count
// across every card the run resolved, landed ones included — a wrong tap is a
// wrong tap whether or not the card was saved. Latency is measured from the
// earliest moment each tile could have spawned, so it reads as "how quickly did
// this player answer what the game gave them", not "how fast did the game go".
export function rainTiebreaks(
  challenge: RunChallenge,
  transcript: RunTranscript,
): RunTiebreaks | undefined {
  if (challenge.mode !== "rain") return undefined;
  // Deliberately lenient: whether this transcript is acceptable was already
  // decided by the scorer, and reading a tiebreak off an already-recorded run
  // must never turn it into a 500.
  const { cards } = gradeRain(challenge, transcript, []);
  const clears = cards.filter((entry) => entry.cleared);
  const totalLatencyMs = clears.reduce(
    (sum, entry) => sum + entry.latencyMs,
    0,
  );
  return {
    wrongGuesses: cards.reduce((sum, entry) => sum + entry.wrongGuesses, 0),
    avgLatencyMs: clears.length
      ? Math.round(totalLatencyMs / clears.length)
      : 0,
  };
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
      return scoreRain(challenge, transcript, wallElapsedMs);
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
      score = scoreRain(challenge, transcript, wallElapsedMs, reviewSignals);
      break;
  }
  return { score, reviewSignals };
}
