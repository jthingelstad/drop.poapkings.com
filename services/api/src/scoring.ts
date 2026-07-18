import rawCards from "@elixir-drop/game-data/cards.json";
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
export const SURGE_CARD_COUNT = 15;
export const SURGE_PENALTY_MS = 2_000;

type RandomInt = (upperBound: number) => number;

export interface ChallengeContext {
  playerCardIds?: readonly number[];
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
  while (result.length < count)
    result.push(...shuffle(pool, randomInt).map((card) => card.id));
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
  return rounds;
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
  return Array.from({ length: 50 }, () => {
    const targetElixir = eligibleCosts[randomInt(eligibleCosts.length)] ?? 4;
    const targets = shuffle(
      sweepPool.filter((card) => card.elixir === targetElixir),
      randomInt,
    ).slice(0, randomInt(2) + 2);
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

export function createChallenge<T extends GameMode>(
  mode: T,
  randomInt: RandomInt,
  context?: ChallengeContext,
): Extract<RunChallenge, { mode: T }>;
export function createChallenge(
  mode: GameMode,
  randomInt: RandomInt,
  context: ChallengeContext = {},
): RunChallenge {
  const playerPool = [...new Set(context.playerCardIds ?? [])]
    .map((id) => CARD_BY_ID.get(id))
    .filter((card): card is Card => Boolean(card));
  // The mode policy decides whether to pass a player collection. A small or
  // stale collection safely falls back to the canonical catalog.
  const pool = playerPool.length >= 12 ? playerPool : CARDS;
  switch (mode) {
    case "surge":
    case "practice":
    case "identify":
      return { mode, cardIds: cardSequence(15, randomInt, pool) };
    case "blitz":
      return { mode, cardIds: cardSequence(240, randomInt, pool) };
    case "survival":
      return { mode, cardIds: cardSequence(250, randomInt, pool) };
    case "higher-lower": {
      const ids = cardSequence(500, randomInt, pool);
      return {
        mode,
        pairs: Array.from(
          { length: 250 },
          (_, index) =>
            [ids[index * 2]!, ids[index * 2 + 1]!] as [number, number],
        ),
      };
    }
    case "trade":
      return { mode, rounds: tradeRounds(randomInt, pool) };
    case "ladder": {
      let cardIds = cardSequence(5, randomInt, pool);
      while (isAscending(cardIds)) cardIds = shuffle(cardIds, randomInt);
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
    if (guesses.length < 1 || guesses.length > 20 || atMs <= previousAtMs + 79)
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

function relation(leftId: number, rightId: number): string {
  const left = card(leftId).elixir;
  const right = card(rightId).elixir;
  return right > left ? "higher" : right < left ? "lower" : "equal";
}

function scoreHigherLower(
  challenge: Extract<RunChallenge, { mode: "higher-lower" }>,
  transcript: RunTranscript,
): number {
  const answers = objectArray(transcript.answers, "Higher/Lower");
  if (!answers.length || answers.length > challenge.pairs.length)
    throw new Error("Higher/Lower transcript is invalid");
  let score = 0;
  let ended = false;
  answers.forEach((answer, index) => {
    if (ended)
      throw new Error("Higher/Lower transcript continues after a miss");
    const pair = challenge.pairs[index]!;
    if (answer.leftId !== pair[0] || answer.rightId !== pair[1])
      throw new Error("Higher/Lower pair is invalid");
    if (answer.choice === relation(...pair)) score += 1;
    else ended = true;
  });
  if (!ended && answers.length < challenge.pairs.length)
    throw new Error("Higher/Lower run has not ended");
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

function isPermutation(actual: number[], expected: number[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((id, index) => id === [...expected].sort()[index])
  );
}

function scoreLadder(
  challenge: Extract<RunChallenge, { mode: "ladder" }>,
  transcript: RunTranscript,
  wallElapsedMs: number,
): number {
  const attempts = objectArray(transcript.attempts, "Ladder");
  if (!attempts.length || attempts.length > 20)
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
  let row = [...challenge.startingIds];
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
  answers.forEach((answer, index) => {
    const cardId = challenge.cardIds[index]!;
    const guesses = numberArray(answer.guesses, "Blitz guesses");
    const atMs = Number(answer.atMs);
    if (answer.cardId !== cardId || atMs <= previousAtMs + 79 || atMs > 60_500)
      throw new Error("Blitz answer is invalid");
    const expected = card(cardId).elixir;
    if (
      !guesses.length ||
      guesses.at(-1) !== expected ||
      guesses.slice(0, -1).includes(expected)
    )
      throw new Error("Blitz guesses are invalid");
    previousAtMs = atMs;
  });
  return answers.length;
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
    const correct = answer.guess === card(cardId).elixir && elapsedMs <= 5_000;
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
  if (wallElapsedMs < 43_000) throw new Error("Cost Sweep run ended too early");
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
      atMs < previousAtMs ||
      atMs + penalties > 45_500
    ) {
      throw new Error("Cost Sweep pick is invalid");
    }
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
      return scoreHigherLower(challenge, transcript);
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
