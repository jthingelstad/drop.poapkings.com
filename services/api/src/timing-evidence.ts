import type { GameMode, RunTranscript, TimingEvidence } from "./types.js";

const INPUT_KINDS = new Set(["pointer", "keyboard", "keyboard-or-assistive"]);
const MAX_INPUT_EVENTS = 20_000;
const SURGE_CORRECT_BEAT_MS = 280;
const SURGE_WRONG_BEAT_MS = 430;
const TRADE_CORRECT_BEAT_MS = 280;
const TRADE_WRONG_BEAT_MS = 720;

interface ObservedInput {
  round: number;
  value: number;
  enabledAtMs: number;
  inputAtMs: number;
  inputKind: "pointer" | "keyboard" | "keyboard-or-assistive";
  trusted: boolean;
}

interface SurgeRecallEvidence {
  inputCount: number;
  activeTotalMs: number;
  under100MsCount: number;
  longestUnder200MsStreak: number;
}

export interface TimingAnalysis {
  evidence: TimingEvidence;
  reviewSignals: string[];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) &&
    value.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    )
    ? (value as Record<string, unknown>[])
    : [];
}

function parseObservedInputs(value: unknown): ObservedInput[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_INPUT_EVENTS)
    return undefined;
  const parsed: ObservedInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return undefined;
    const candidate = item as Record<string, unknown>;
    const round = Number(candidate.round);
    const value = Number(candidate.value);
    const enabledAtMs = Number(candidate.enabledAtMs);
    const inputAtMs = Number(candidate.inputAtMs);
    const inputKind = candidate.inputKind;
    if (
      !Number.isSafeInteger(round) ||
      round < 0 ||
      !Number.isSafeInteger(value) ||
      !Number.isFinite(enabledAtMs) ||
      !Number.isFinite(inputAtMs) ||
      enabledAtMs < 0 ||
      inputAtMs < enabledAtMs ||
      typeof inputKind !== "string" ||
      !INPUT_KINDS.has(inputKind) ||
      typeof candidate.trusted !== "boolean"
    )
      return undefined;
    parsed.push({
      round,
      value,
      enabledAtMs,
      inputAtMs,
      inputKind: inputKind as ObservedInput["inputKind"],
      trusted: candidate.trusted,
    });
  }
  if (
    parsed.some(
      (event, index) =>
        index > 0 && event.inputAtMs < parsed[index - 1]!.inputAtMs,
    )
  )
    return undefined;
  return parsed;
}

function inputsMatchTranscript(
  mode: GameMode,
  transcript: RunTranscript,
  inputs: ObservedInput[],
): boolean {
  const answers = records(transcript.answers);
  if (mode === "surge" || mode === "trade") {
    const expected = answers.flatMap((answer, round) =>
      Array.isArray(answer.guesses)
        ? answer.guesses.map((value) => ({ round, value: Number(value) }))
        : [],
    );
    return (
      expected.length === inputs.length &&
      expected.every(
        (value, index) =>
          value.round === inputs[index]!.round &&
          value.value === inputs[index]!.value,
      )
    );
  }
  if (mode === "higher-lower") {
    const expected = answers.flatMap((answer, round) =>
      answer.timedOut === true
        ? []
        : [{ round, value: Number(answer.pickedId) }],
    );
    return (
      expected.length === inputs.length &&
      expected.every(
        (value, index) =>
          value.round === inputs[index]!.round &&
          value.value === inputs[index]!.value,
      )
    );
  }
  if (mode === "survival") {
    const expected = answers.flatMap((answer, round) =>
      answer.guess === null ? [] : [{ round, value: Number(answer.guess) }],
    );
    return (
      expected.length === inputs.length &&
      expected.every(
        (value, index) =>
          value.round === inputs[index]!.round &&
          value.value === inputs[index]!.value,
      )
    );
  }
  if (mode === "rain") {
    const byRound = new Map<number, ObservedInput[]>();
    for (const input of inputs) {
      const group = byRound.get(input.round) ?? [];
      group.push(input);
      byRound.set(input.round, group);
    }
    let expectedCount = 0;
    for (const answer of answers) {
      const round = Number(answer.inputRound);
      const wrong = Number(answer.wrongGuesses);
      if (
        !Number.isSafeInteger(round) ||
        !Number.isSafeInteger(wrong) ||
        wrong < 0
      )
        return false;
      const expectedForRound = wrong + (answer.guess === null ? 0 : 1);
      const group = byRound.get(round) ?? [];
      if (group.length !== expectedForRound) return false;
      if (answer.guess !== null && group.at(-1)?.value !== Number(answer.guess))
        return false;
      expectedCount += expectedForRound;
    }
    return expectedCount === inputs.length;
  }
  return inputs.length === 0;
}

function percentile(sorted: number[], fraction: number): number | undefined {
  if (!sorted.length) return undefined;
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function observedEvidence(inputs: ObservedInput[]): TimingEvidence {
  const active = inputs.map((event) =>
    Math.max(0, event.inputAtMs - event.enabledAtMs),
  );
  const sorted = [...active].sort((a, b) => a - b);
  let longestUnder200MsStreak = 0;
  let currentStreak = 0;
  for (const duration of active) {
    currentStreak = duration < 200 ? currentStreak + 1 : 0;
    longestUnder200MsStreak = Math.max(longestUnder200MsStreak, currentStreak);
  }
  const inputKindCounts: Record<string, number> = {};
  for (const input of inputs)
    inputKindCounts[input.inputKind] =
      (inputKindCounts[input.inputKind] ?? 0) + 1;
  return {
    model: "observed-v2",
    inputCount: inputs.length,
    activeTotalMs: Math.round(active.reduce((sum, value) => sum + value, 0)),
    ...(percentile(sorted, 0.5) !== undefined
      ? { activeMedianMs: Math.round(percentile(sorted, 0.5)!) }
      : {}),
    ...(percentile(sorted, 0.1) !== undefined
      ? { activeP10Ms: Math.round(percentile(sorted, 0.1)!) }
      : {}),
    under100MsCount: active.filter((value) => value < 100).length,
    under150MsCount: active.filter((value) => value < 150).length,
    longestUnder200MsStreak,
    inputKindCounts,
    untrustedInputCount: inputs.filter((input) => !input.trusted).length,
  };
}

// Surge keeps a card live after a miss, so its sidecar contains both the
// player's independent recall attempt and any correction taps made after the
// higher/lower hint. The latter are still useful exact evidence and remain in
// the retained summary, but they are not independent demonstrations of recall
// and must not trigger the automatic subhuman-response holds.
//
// A one-guess round is necessarily a correct first read because the scorer has
// already validated the transcript before timing analysis runs. Preserve round
// adjacency in the streak calculation so wrong-first rounds break a purported
// sustained sequence instead of disappearing from it.
function surgeRecallEvidence(
  transcript: RunTranscript,
  inputs: ObservedInput[],
): SurgeRecallEvidence {
  const answers = records(transcript.answers);
  const independent = inputs.filter((input) => {
    const guesses = answers[input.round]?.guesses;
    return Array.isArray(guesses) && guesses.length === 1;
  });
  const active = independent.map((event) =>
    Math.max(0, event.inputAtMs - event.enabledAtMs),
  );
  let longestUnder200MsStreak = 0;
  let currentStreak = 0;
  let previousRound: number | undefined;
  for (let index = 0; index < independent.length; index += 1) {
    const event = independent[index]!;
    const consecutive =
      previousRound === undefined || event.round === previousRound + 1;
    currentStreak =
      active[index]! < 200 ? (consecutive ? currentStreak + 1 : 1) : 0;
    longestUnder200MsStreak = Math.max(longestUnder200MsStreak, currentStreak);
    previousRound = event.round;
  }
  return {
    inputCount: independent.length,
    activeTotalMs: Math.round(active.reduce((sum, value) => sum + value, 0)),
    under100MsCount: active.filter((value) => value < 100).length,
    longestUnder200MsStreak,
  };
}

function inferredEvidence(
  mode: GameMode,
  transcript: RunTranscript,
): TimingEvidence {
  const answers = records(transcript.answers);
  if (mode !== "surge" && mode !== "trade")
    return { model: "inferred-v1", inputCount: 0 };
  const correctBeat =
    mode === "surge" ? SURGE_CORRECT_BEAT_MS : TRADE_CORRECT_BEAT_MS;
  const wrongBeat =
    mode === "surge" ? SURGE_WRONG_BEAT_MS : TRADE_WRONG_BEAT_MS;
  let previousAtMs = 0;
  let activeTotalMs = 0;
  let inputCount = 0;
  for (let index = 0; index < answers.length; index += 1) {
    const atMs = Number(answers[index]!.atMs);
    const guesses: unknown[] = Array.isArray(answers[index]!.guesses)
      ? (answers[index]!.guesses as unknown[])
      : [];
    if (!Number.isFinite(atMs)) return { model: "invalid-v2", inputCount: 0 };
    activeTotalMs +=
      atMs -
      previousAtMs -
      (index > 0 ? correctBeat : 0) -
      Math.max(0, guesses.length - 1) * wrongBeat;
    inputCount += guesses.length;
    previousAtMs = atMs;
  }
  return {
    model: "inferred-v1",
    inputCount,
    activeTotalMs: Math.max(0, Math.round(activeTotalMs)),
  };
}

export function analyzeTimingEvidence(
  mode: GameMode,
  transcript: RunTranscript,
): TimingAnalysis {
  const hasObserved = Object.prototype.hasOwnProperty.call(
    transcript,
    "inputEvents",
  );
  const inputs = hasObserved
    ? parseObservedInputs(transcript.inputEvents)
    : undefined;
  const valid =
    inputs !== undefined && inputsMatchTranscript(mode, transcript, inputs);
  const evidence: TimingEvidence = hasObserved
    ? valid
      ? observedEvidence(inputs)
      : {
          model: "invalid-v2",
          inputCount: Array.isArray(transcript.inputEvents)
            ? transcript.inputEvents.length
            : 0,
        }
    : inferredEvidence(mode, transcript);
  const surgeRecall =
    valid && mode === "surge"
      ? surgeRecallEvidence(transcript, inputs!)
      : undefined;
  const reviewSignals: string[] = [];
  if (evidence.model === "invalid-v2")
    reviewSignals.push("input_timing_invalid");
  // Legacy transcripts can only provide a coarse reconstruction. Preserve it
  // for the referee, but reserve automatic holds for the display-to-input
  // observations emitted by current clients.
  if (
    evidence.model === "observed-v2" &&
    mode === "surge" &&
    surgeRecall?.inputCount === records(transcript.answers).length &&
    surgeRecall.activeTotalMs < 4_500
  )
    reviewSignals.push("surge_active_time_below_review_floor");
  if (
    evidence.model === "observed-v2" &&
    mode === "surge" &&
    (surgeRecall?.under100MsCount ?? 0) >= 3
  )
    reviewSignals.push("surge_repeated_sub_100ms_inputs");
  if (
    evidence.model === "observed-v2" &&
    mode === "surge" &&
    (surgeRecall?.longestUnder200MsStreak ?? 0) >= 4
  )
    reviewSignals.push("surge_sustained_sub_200ms_inputs");
  if (
    evidence.inputCount >= 3 &&
    (evidence.untrustedInputCount ?? 0) >= 3 &&
    (evidence.untrustedInputCount ?? 0) > evidence.inputCount * 0.25
  )
    reviewSignals.push("input_events_repeatedly_untrusted");
  return { evidence, reviewSignals };
}
