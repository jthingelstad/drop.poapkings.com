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

export function cardElixir(id: number): number | undefined {
  return CARD_BY_ID.get(id)?.elixir;
}
export const SURGE_CARD_COUNT = 15;
export const SURGE_PENALTY_MS = 2_000;
export const BLITZ_CARD_COUNT = 240;
export const HIGHER_LOWER_PAIR_COUNT = 250;

type RandomInt = (upperBound: number) => number;

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

function sweepBoards(
  randomInt: RandomInt,
  pool: readonly Card[],
): Array<{ targetElixir: number; cardIds: number[] }> {
  const targetCosts = [...new Set(pool.map((card) => card.elixir))].filter(
    (cost) => pool.filter((card) => card.elixir === cost).length >= 3,
  );
  const sweepPool = targetCosts.length ? pool : CARDS;
  const eligibleCosts = targetCosts.length
    ? targetCosts
    : [...new Set(CARDS.map((card) => card.elixir))].filter(
        (cost) => CARDS.filter((card) => card.elixir === cost).length >= 3,
      );
  return Array.from({ length: 50 }, (_, boardIndex) => {
    const targetElixir = eligibleCosts[randomInt(eligibleCosts.length)] ?? 4;
    // Escalate across boards: two targets to find early, four by the fifth
    // board — clean early boards earn a harder, higher-scoring late run.
    const desiredTargets = Math.min(4, 2 + Math.floor(boardIndex / 2));
    const targets = shuffle(
      sweepPool.filter((card) => card.elixir === targetElixir),
      randomInt,
    ).slice(0, desiredTargets);
    const fillers = shuffle(
      sweepPool.filter((card) => card.elixir !== targetElixir),
      randomInt,
    ).slice(0, 12 - targets.length);
    return {
      targetElixir,
      cardIds: shuffle([...targets, ...fillers], randomInt).map(
        (card) => card.id,
      ),
    };
  });
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
    case "identify":
      return { mode, cardIds: cardSequence(15, randomInt, pool) };
    case "blitz":
      return { mode, cardIds: cardSequence(BLITZ_CARD_COUNT, randomInt, pool) };
    case "survival":
      return { mode, cardIds: cardSequence(250, randomInt, pool) };
    case "higher-lower":
      return { mode, pairs: higherLowerPairs(randomInt, pool) };
    case "trade":
      return { mode, rounds: tradeRounds(randomInt, pool) };
    case "ladder": {
      let cardIds = cardSequence(5, randomInt, pool);
      // A draw where all five cards share one elixir cost can never become
      // "not ascending" — the old unbounded shuffle loop hung the Lambda
      // (~0.2% of draws). Redraw, fall back to the full catalog, and finish
      // deterministically instead of spinning.
      for (let redraw = 0; redraw < 20 && allSameCost(cardIds); redraw += 1)
        cardIds = cardSequence(5, randomInt, pool);
      if (allSameCost(cardIds)) cardIds = cardSequence(5, randomInt, CARDS);
      for (let attempt = 0; attempt < 50 && isAscending(cardIds); attempt += 1)
        cardIds = shuffle(cardIds, randomInt);
      // With two distinct costs present, the reverse of an ascending order is
      // guaranteed non-ascending.
      if (isAscending(cardIds)) cardIds = [...cardIds].reverse();
      return { mode, cardIds };
    }
    case "endless-ladder": {
      const ids = cardSequence(252, randomInt, pool);
      return {
        mode,
        startingIds: sortIds(ids.slice(0, 2)),
        cardIds: ids.slice(2),
      };
    }
    case "cost-sweep":
      return { mode, boards: sweepBoards(randomInt, pool) };
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

function verifyPlausibleEnd(atMs: number, wallElapsedMs: number): void {
  if (!Number.isFinite(atMs) || atMs < 500 || atMs > wallElapsedMs + 2_000)
    throw new Error("Run timing is not plausible");
}

function scoreAnswerSprint(
  challenge: number[],
  transcript: RunTranscript,
  wallElapsedMs: number,
  answerKind: "elixir" | "card",
): number {
  const answers = objectArray(transcript.answers, "Answer");
  if (answers.length !== challenge.length)
    throw new Error("A complete answer transcript is required");
  let previousAtMs = 0;
  let misses = 0;
  for (let index = 0; index < challenge.length; index += 1) {
    const expectedCardId = challenge[index]!;
    const answer = answers[index]!;
    if (answer.cardId !== expectedCardId)
      throw new Error("Card order does not match the signed run");
    const guesses = numberArray(answer.guesses, "Guesses");
    const atMs = Number(answer.atMs);
    // The cap bounds payload size, not honest play: a struggling beginner
    // mashing the keypad must not have the whole run voided (the client stops
    // recording at the same limit).
    if (guesses.length < 1 || guesses.length > 60 || atMs <= previousAtMs + 79)
      throw new Error("Answer timing is invalid");
    const correct =
      answerKind === "elixir" ? card(expectedCardId).elixir : expectedCardId;
    if (guesses.at(-1) !== correct || guesses.slice(0, -1).includes(correct))
      throw new Error("Answer sequence is invalid");
    if (
      answerKind === "elixir" &&
      guesses.some((guess) => guess < 1 || guess > 10)
    )
      throw new Error("Elixir guess is invalid");
    if (answerKind === "card" && new Set(guesses).size !== guesses.length)
      throw new Error("Identify guesses must be unique");
    misses += guesses.length - 1;
    previousAtMs = atMs;
  }
  verifyPlausibleEnd(previousAtMs, wallElapsedMs);
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
): number {
  const answers = objectArray(transcript.answers, "Higher/Lower");
  if (!answers.length || answers.length > challenge.pairs.length)
    throw new Error("Higher/Lower transcript is invalid");
  let score = 0;
  let totalElapsed = 0;
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
    if (correct && elapsedMs < 100)
      throw new Error("Higher/Lower answer is implausibly fast");
    if (correct) score += 1;
    else ended = true;
  });
  if (!ended && answers.length < challenge.pairs.length)
    throw new Error("Higher/Lower run has not ended");
  if (totalElapsed > wallElapsedMs + 2_000)
    throw new Error("Higher/Lower timing is not plausible");
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
  verifyPlausibleEnd(atMs, wallElapsedMs);
  return Math.round(atMs) + misses * 2_000;
}

function sortIds(ids: number[]): number[] {
  return [...ids].sort(
    (left, right) =>
      card(left).elixir - card(right).elixir ||
      card(left).name.localeCompare(card(right).name),
  );
}

function isAscending(ids: number[]): boolean {
  return ids.every(
    (id, index) =>
      index === 0 || card(ids[index - 1]!).elixir <= card(id).elixir,
  );
}

function allSameCost(ids: number[]): boolean {
  return ids.every((id) => card(id).elixir === card(ids[0]!).elixir);
}

function isPermutation(actual: number[], expected: number[]): boolean {
  const sortedActual = [...actual].sort((left, right) => left - right);
  const sortedExpected = [...expected].sort((left, right) => left - right);
  return (
    actual.length === expected.length &&
    sortedActual.every((id, index) => id === sortedExpected[index])
  );
}

function scoreLadder(
  challenge: Extract<RunChallenge, { mode: "ladder" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  const attempts = objectArray(transcript.attempts, "Ladder");
  // Sized for a genuinely struggling beginner (the client stops recording at
  // the same limit), while still bounding the payload.
  if (!attempts.length || attempts.length > 60)
    throw new Error("Ladder transcript is invalid");
  let finalAtMs = 0;
  attempts.forEach((attempt, index) => {
    const order = numberArray(attempt.order, "Ladder order");
    if (!isPermutation(order, challenge.cardIds))
      throw new Error("Ladder order is not the signed challenge");
    const ascending = isAscending(order);
    if (index < attempts.length - 1 && ascending)
      throw new Error("Ladder continued after a correct order");
    if (index === attempts.length - 1 && !ascending)
      throw new Error("Ladder final order is not correct");
    finalAtMs = Number(attempt.atMs);
  });
  verifyPlausibleEnd(finalAtMs, wallElapsedMs);
  return Math.round(finalAtMs) + (attempts.length - 1) * 2_000;
}

function canInsert(row: number[], cardId: number, slot: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot > row.length) return false;
  const value = card(cardId).elixir;
  const left = row[slot - 1];
  const right = row[slot];
  return (
    (!left || card(left).elixir <= value) &&
    (!right || value <= card(right).elixir)
  );
}

function scoreEndless(
  challenge: Extract<RunChallenge, { mode: "endless-ladder" }>,
  transcript: RunTranscript,
): number {
  const attempts = objectArray(transcript.attempts, "Endless Ladder");
  if (!attempts.length || attempts.length > challenge.cardIds.length)
    throw new Error("Endless Ladder transcript is invalid");
  const row = [...challenge.startingIds];
  let score = 0;
  let ended = false;
  attempts.forEach((attempt, index) => {
    if (ended) throw new Error("Endless Ladder continued after a miss");
    const cardId = challenge.cardIds[index]!;
    if (attempt.cardId !== cardId || !Number.isInteger(attempt.slotIndex))
      throw new Error("Endless Ladder attempt is invalid");
    if (canInsert(row, cardId, Number(attempt.slotIndex))) {
      row.splice(Number(attempt.slotIndex), 0, cardId);
      score += 1;
    } else {
      ended = true;
    }
  });
  if (!ended && attempts.length < challenge.cardIds.length)
    throw new Error("Endless Ladder run has not ended");
  return score;
}

function scoreBlitz(
  challenge: Extract<RunChallenge, { mode: "blitz" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  const answers = objectArray(transcript.answers, "Blitz");
  if (wallElapsedMs < 58_000 || answers.length > challenge.cardIds.length)
    throw new Error("Blitz run ended too early");
  let previousAtMs = 0;
  let cleared = 0;
  for (const [index, answer] of answers.entries()) {
    const cardId = challenge.cardIds[index]!;
    const guesses = numberArray(answer.guesses, "Blitz guesses");
    const atMs = Number(answer.atMs);
    if (
      answer.cardId !== cardId ||
      !Number.isFinite(atMs) ||
      atMs <= previousAtMs + 79
    )
      throw new Error("Blitz answer is invalid");
    // Answers past the buzzer (a suspended rAF clock kept the board live) are
    // clipped rather than voiding the whole run.
    if (atMs > 60_500) break;
    const expected = card(cardId).elixir;
    if (
      !guesses.length ||
      guesses.at(-1) !== expected ||
      guesses.slice(0, -1).includes(expected)
    )
      throw new Error("Blitz guesses are invalid");
    previousAtMs = atMs;
    cleared += 1;
  }
  return cleared;
}

function scoreSurvival(
  challenge: Extract<RunChallenge, { mode: "survival" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  const answers = objectArray(transcript.answers, "Survival");
  if (!answers.length || answers.length > challenge.cardIds.length)
    throw new Error("Survival transcript is invalid");
  let score = 0;
  let totalElapsed = 0;
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
    if (correct && elapsedMs < 100)
      throw new Error("Survival answer is implausibly fast");
    if (correct) score += 1;
    else ended = true;
  });
  if (!ended && answers.length < challenge.cardIds.length)
    throw new Error("Survival run has not ended");
  if (totalElapsed + score * 200 > wallElapsedMs + 2_000)
    throw new Error("Survival timing is not plausible");
  return score;
}

function scoreSweep(
  challenge: Extract<RunChallenge, { mode: "cost-sweep" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  const picks = objectArray(transcript.picks, "Cost Sweep");
  let boardIndex = 0;
  let previousAtMs = 0;
  let penalties = 0;
  let found = 0;
  let selected = new Set<number>();
  for (const pick of picks) {
    const board = challenge.boards[boardIndex];
    if (!board) throw new Error("Cost Sweep exceeded its signed boards");
    const cardId = Number(pick.cardId);
    const atMs = Number(pick.atMs);
    if (
      pick.boardIndex !== boardIndex ||
      !board.cardIds.includes(cardId) ||
      !Number.isFinite(atMs) ||
      atMs < previousAtMs
    ) {
      throw new Error("Cost Sweep pick is invalid");
    }
    // A tap past the buzzer (a suspended rAF clock on iOS, a tap in flight at
    // the horn) clips the run at the window instead of voiding it.
    if (atMs + penalties > 45_500) break;
    previousAtMs = atMs;
    if (card(cardId).elixir === board.targetElixir) {
      if (selected.has(cardId))
        throw new Error("Cost Sweep target was selected twice");
      selected.add(cardId);
      found += 1;
      const targets = board.cardIds.filter(
        (id) => card(id).elixir === board.targetElixir,
      );
      if (targets.every((id) => selected.has(id))) {
        boardIndex += 1;
        selected = new Set();
      }
    } else {
      penalties += 2_000;
    }
  }
  // The 45s window shrinks by 2s per wrong tap, so an honest run's wall time
  // is 45s minus its penalties: validate the effective window, not raw wall
  // time (a static floor rejected honest runs with three or more wrong taps).
  if (wallElapsedMs + penalties < 43_000)
    throw new Error("Cost Sweep run ended too early");
  return found;
}

export function scoreRun(
  challenge: RunChallenge,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  switch (challenge.mode) {
    case "surge":
      return scoreAnswerSprint(
        challenge.cardIds,
        transcript,
        wallElapsedMs,
        "elixir",
      );
    case "practice":
      return scorePractice(challenge, transcript);
    case "identify":
      return scoreAnswerSprint(
        challenge.cardIds,
        transcript,
        wallElapsedMs,
        "card",
      );
    case "higher-lower":
      return scoreHigherLower(challenge, transcript, wallElapsedMs);
    case "trade":
      return scoreTrade(challenge, transcript, wallElapsedMs);
    case "ladder":
      return scoreLadder(challenge, transcript, wallElapsedMs);
    case "endless-ladder":
      return scoreEndless(challenge, transcript);
    case "cost-sweep":
      return scoreSweep(challenge, transcript, wallElapsedMs);
    case "blitz":
      return scoreBlitz(challenge, transcript, wallElapsedMs);
    case "survival":
      return scoreSurvival(challenge, transcript, wallElapsedMs);
  }
}
