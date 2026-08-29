import {
  rainSpawnIntervalMs,
  RESPONSE_WINDOW_TOLERANCE_MS,
  survivalWindowMs,
  type GameMode,
} from "@elixir-drop/contracts";
import rawCards from "@elixir-drop/game-data/cards.json";
import type { EvidenceItem, RunShareVisual } from "./types.js";

const MAX_BARS = 30;
const SURGE_PENALTY_MS = 2_000;

interface CardFact {
  id: number;
  elixir: number;
}

const cards = new Map(
  (rawCards.cards as CardFact[]).map((card) => [card.id, card.elixir]),
);

function objects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
    : [];
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function bucket(values: number[]): number[] {
  if (values.length <= MAX_BARS) return values;
  const result: number[] = [];
  for (let index = 0; index < MAX_BARS; index += 1) {
    const start = Math.floor((index * values.length) / MAX_BARS);
    const end = Math.floor(((index + 1) * values.length) / MAX_BARS);
    result.push(average(values.slice(start, end)));
  }
  return result;
}

function bucketFlags(flags: boolean[], keepFatalLast = false): boolean[] {
  if (flags.length <= MAX_BARS) return flags;
  if (keepFatalLast && flags.at(-1)) {
    const pooled = flags.slice(0, -1);
    const result: boolean[] = [];
    for (let index = 0; index < MAX_BARS - 1; index += 1) {
      const start = Math.floor((index * pooled.length) / (MAX_BARS - 1));
      const end = Math.floor(((index + 1) * pooled.length) / (MAX_BARS - 1));
      result.push(pooled.slice(start, end).some(Boolean));
    }
    result.push(true);
    return result;
  }
  const result: boolean[] = [];
  for (let index = 0; index < MAX_BARS; index += 1) {
    const start = Math.floor((index * flags.length) / MAX_BARS);
    const end = Math.floor(((index + 1) * flags.length) / MAX_BARS);
    result.push(flags.slice(start, end).some(Boolean));
  }
  return result;
}

function boundedVisual(
  visual: RunShareVisual,
  keepFatalLast = false,
): RunShareVisual {
  if (visual.values.length <= MAX_BARS) return visual;
  if (keepFatalLast && visual.bad?.at(-1)) {
    const pooledValues = visual.values.slice(0, -1);
    const pooledRefs = visual.refs?.slice(0, -1);
    const values: number[] = [];
    const refs: number[] = [];
    for (let index = 0; index < MAX_BARS - 1; index += 1) {
      const start = Math.floor((index * pooledValues.length) / (MAX_BARS - 1));
      const end = Math.floor(
        ((index + 1) * pooledValues.length) / (MAX_BARS - 1),
      );
      values.push(average(pooledValues.slice(start, end)));
      if (pooledRefs) refs.push(average(pooledRefs.slice(start, end)));
    }
    values.push(visual.values.at(-1) ?? 0);
    if (visual.refs) refs.push(visual.refs.at(-1) ?? 0);
    return {
      ...visual,
      values,
      ...(visual.refs ? { refs } : {}),
      ...(visual.bad ? { bad: bucketFlags(visual.bad, true) } : {}),
    };
  }
  return {
    ...visual,
    values: bucket(visual.values),
    ...(visual.refs ? { refs: bucket(visual.refs) } : {}),
    ...(visual.bad ? { bad: bucketFlags(visual.bad) } : {}),
  };
}

function elapsedValues(answers: Array<Record<string, unknown>>): number[] {
  return answers.flatMap((answer) => {
    const value = finite(answer.elapsedMs);
    return value === undefined ? [] : [value];
  });
}

function surgeVisual(
  evidence: EvidenceItem,
  previousBest?: RunShareVisual,
): RunShareVisual | undefined {
  const answers = objects(evidence.transcript.answers);
  if (!answers.length) return undefined;
  let misses = 0;
  const cumulative = answers.flatMap((answer) => {
    const atMs = finite(answer.atMs);
    if (atMs === undefined) return [];
    const guesses = Array.isArray(answer.guesses) ? answer.guesses : [];
    misses += Math.max(0, guesses.length - 1);
    return [atMs + misses * SURGE_PENALTY_MS];
  });
  const values = cumulative.map((value, index) =>
    Math.max(0, value - (cumulative[index - 1] ?? 0)),
  );
  if (!values.length) return undefined;
  const refs =
    previousBest?.mode === "surge" &&
    previousBest.values.length === values.length
      ? previousBest.values
      : undefined;
  return boundedVisual({
    mode: "surge",
    unit: "SECONDS PER CARD",
    values,
    ...(refs
      ? {
          refs,
          bad: values.map((value, index) => value > (refs[index] ?? value)),
        }
      : {}),
  });
}

function tradeVisual(evidence: EvidenceItem): RunShareVisual | undefined {
  const answers = objects(evidence.transcript.answers);
  const cumulative = answers.flatMap((answer) => {
    const value = finite(answer.atMs);
    return value === undefined ? [] : [value];
  });
  if (!cumulative.length) return undefined;
  const values = cumulative.map((value, index) =>
    Math.max(0, value - (cumulative[index - 1] ?? 0)),
  );
  const mean = average(values);
  return boundedVisual({
    mode: "trade",
    unit: "SECONDS PER EXCHANGE",
    values,
    refs: values.map(() => mean),
    bad: answers.map(
      (answer) => Array.isArray(answer.guesses) && answer.guesses.length > 1,
    ),
  });
}

function higherLowerVisual(evidence: EvidenceItem): RunShareVisual | undefined {
  if (evidence.challenge.mode !== "higher-lower") return undefined;
  const challenge = evidence.challenge;
  const answers = objects(evidence.transcript.answers);
  const values = elapsedValues(answers);
  if (!values.length) return undefined;
  const bad = answers.map((answer, index) => {
    if (answer.timedOut === true) return true;
    const pair = challenge.pairs[index];
    const picked = finite(answer.pickedId);
    if (!pair || picked === undefined || !pair.includes(picked)) return true;
    const other = pair[0] === picked ? pair[1] : pair[0];
    return (cards.get(picked) ?? -1) <= (cards.get(other) ?? -1);
  });
  const mean = average(values);
  return boundedVisual({
    mode: "higher-lower",
    unit: "SECONDS PER READ",
    values,
    refs: values.map(() => mean),
    bad,
  });
}

function survivalVisual(evidence: EvidenceItem): RunShareVisual | undefined {
  const answers = objects(evidence.transcript.answers);
  const values = elapsedValues(answers);
  if (!values.length) return undefined;
  const refs = values.map((_, index) => Math.round(survivalWindowMs(index)));
  const bad = values.map(() => false);
  const final = answers.at(-1);
  const finalIndex = answers.length - 1;
  if (final && evidence.challenge.mode === "survival") {
    const expectedCard = evidence.challenge.cardIds[finalIndex];
    const expectedCost =
      expectedCard === undefined ? undefined : cards.get(expectedCard);
    if (
      final.guess !== expectedCost ||
      (values[finalIndex] ?? 0) >
        (refs[finalIndex] ?? 0) + RESPONSE_WINDOW_TOLERANCE_MS
    )
      bad[finalIndex] = true;
  }
  return boundedVisual(
    {
      mode: "survival",
      unit: "SECONDS PER CARD",
      values,
      refs,
      bad,
    },
    true,
  );
}

function rainVisual(evidence: EvidenceItem): RunShareVisual | undefined {
  const answers = objects(evidence.transcript.answers);
  if (!answers.length) return undefined;
  let spawnAt = 0;
  const values: number[] = [];
  const bad: boolean[] = [];
  answers.forEach((answer, index) => {
    const atMs = finite(answer.atMs);
    if (atMs === undefined) return;
    values.push(Math.max(0, atMs - Math.round(spawnAt)));
    const cardId = finite(answer.cardId);
    bad.push(
      answer.guess === null ||
        cardId === undefined ||
        answer.guess !== cards.get(cardId),
    );
    spawnAt += rainSpawnIntervalMs(index);
  });
  if (!values.length) return undefined;
  return boundedVisual({
    mode: "rain",
    unit: "SECONDS AFTER SPAWN",
    values,
    bad,
  });
}

export function deriveRunShareVisual(
  evidence: EvidenceItem | undefined,
  previousBest?: RunShareVisual,
): RunShareVisual | undefined {
  if (!evidence || evidence.runType !== "ranked") return undefined;
  const mode: GameMode = evidence.mode;
  switch (mode) {
    case "surge":
      return surgeVisual(evidence, previousBest);
    case "trade":
      return tradeVisual(evidence);
    case "higher-lower":
      return higherLowerVisual(evidence);
    case "survival":
      return survivalVisual(evidence);
    case "rain":
      return rainVisual(evidence);
    case "practice":
      return undefined;
  }
}
