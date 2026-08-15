import { describe, expect, it } from "vitest";
import { analyzeTimingEvidence } from "../src/timing-evidence.js";

function surgeTranscript(activeMs: number, trusted = true) {
  const answers = Array.from({ length: 15 }, (_, round) => ({
    cardId: 26_000_000 + round,
    guesses: [3],
    atMs: activeMs * (round + 1) + 280 * round,
  }));
  const inputEvents = answers.map((answer, round) => ({
    round,
    value: 3,
    enabledAtMs: round === 0 ? 0 : answers[round - 1]!.atMs + 280,
    inputAtMs: answer.atMs,
    inputKind: "pointer",
    trusted,
  }));
  return { answers, inputEvents };
}

function correctionHeavySurgeTranscript() {
  let enabledAtMs = 0;
  const answers: Array<{
    cardId: number;
    guesses: number[];
    atMs: number;
  }> = [];
  const inputEvents: Array<{
    round: number;
    value: number;
    enabledAtMs: number;
    inputAtMs: number;
    inputKind: "pointer";
    trusted: boolean;
  }> = [];
  for (let round = 0; round < 15; round += 1) {
    const guesses = round < 3 ? [1, 2, 1, 2, 3] : [3];
    for (const [guessIndex, value] of guesses.entries()) {
      const inputAtMs = enabledAtMs + (guessIndex === 0 ? 320 : 40);
      inputEvents.push({
        round,
        value,
        enabledAtMs,
        inputAtMs,
        inputKind: "pointer",
        trusted: true,
      });
      enabledAtMs = inputAtMs + (guessIndex === guesses.length - 1 ? 280 : 430);
    }
    answers.push({
      cardId: 26_000_000 + round,
      guesses,
      atMs: inputEvents.at(-1)!.inputAtMs,
    });
  }
  return { answers, inputEvents };
}

describe("competitive input timing evidence", () => {
  it("sums display-to-input time without the forced Surge transitions", () => {
    const analysis = analyzeTimingEvidence("surge", surgeTranscript(320));
    expect(analysis.evidence).toMatchObject({
      model: "observed-v2",
      inputCount: 15,
      activeTotalMs: 4_800,
      activeMedianMs: 320,
      under100MsCount: 0,
    });
    expect(analysis.reviewSignals).toEqual([]);
  });

  it("holds a sustained superhuman observed run for review", () => {
    const analysis = analyzeTimingEvidence("surge", surgeTranscript(80));
    expect(analysis.evidence).toMatchObject({
      activeTotalMs: 1_200,
      under100MsCount: 15,
      longestUnder200MsStreak: 15,
    });
    expect(analysis.reviewSignals).toEqual([
      "surge_active_time_below_review_floor",
      "surge_repeated_sub_100ms_inputs",
      "surge_sustained_sub_200ms_inputs",
    ]);
  });

  it("retains rapid Surge corrections without treating them as independent recall", () => {
    const analysis = analyzeTimingEvidence(
      "surge",
      correctionHeavySurgeTranscript(),
    );

    // The exact sidecar still reports every rapid correction for the referee.
    expect(analysis.evidence).toMatchObject({
      model: "observed-v2",
      inputCount: 27,
      under100MsCount: 12,
      longestUnder200MsStreak: 4,
    });
    // Only correct first reads drive the automatic recall-speed signals.
    expect(analysis.reviewSignals).toEqual([]);
  });

  it("derives a legacy active budget by removing correct and wrong lockouts", () => {
    const analysis = analyzeTimingEvidence("surge", {
      answers: [
        { cardId: 1, guesses: [2, 3], atMs: 500 },
        { cardId: 2, guesses: [4], atMs: 1_300 },
      ],
    });
    expect(analysis.evidence).toEqual({
      model: "inferred-v1",
      inputCount: 3,
      activeTotalMs: 590,
    });
    expect(analysis.reviewSignals).toEqual([]);
  });

  it("flags a sidecar that does not match the scored guesses", () => {
    const transcript = surgeTranscript(320);
    transcript.inputEvents[0]!.value = 9;
    const analysis = analyzeTimingEvidence("surge", transcript);
    expect(analysis.evidence.model).toBe("invalid-v2");
    expect(analysis.reviewSignals).toEqual(["input_timing_invalid"]);
  });

  it("treats repeated synthetic events as corroborating review evidence", () => {
    const analysis = analyzeTimingEvidence(
      "surge",
      surgeTranscript(320, false),
    );
    expect(analysis.evidence.untrustedInputCount).toBe(15);
    expect(analysis.reviewSignals).toContain(
      "input_events_repeatedly_untrusted",
    );
  });

  it("matches input sidecars to every other ranked transcript shape", () => {
    const cases = [
      {
        mode: "trade" as const,
        transcript: {
          answers: [{ guesses: [-2, -1], atMs: 900 }],
          inputEvents: [
            {
              round: 0,
              value: -2,
              enabledAtMs: 0,
              inputAtMs: 400,
              inputKind: "pointer",
              trusted: true,
            },
            {
              round: 0,
              value: -1,
              enabledAtMs: 720,
              inputAtMs: 900,
              inputKind: "pointer",
              trusted: true,
            },
          ],
        },
      },
      {
        mode: "higher-lower" as const,
        transcript: {
          answers: [{ pickedId: 26_000_001 }, { timedOut: true }],
          inputEvents: [
            {
              round: 0,
              value: 26_000_001,
              enabledAtMs: 0,
              inputAtMs: 500,
              inputKind: "keyboard",
              trusted: true,
            },
          ],
        },
      },
      {
        mode: "survival" as const,
        transcript: {
          answers: [{ guess: 3 }, { guess: null }],
          inputEvents: [
            {
              round: 0,
              value: 3,
              enabledAtMs: 0,
              inputAtMs: 450,
              inputKind: "pointer",
              trusted: true,
            },
          ],
        },
      },
      {
        mode: "rain" as const,
        transcript: {
          answers: [
            { inputRound: 3, wrongGuesses: 1, guess: 4 },
            { inputRound: 4, wrongGuesses: 0, guess: null },
          ],
          inputEvents: [
            {
              round: 3,
              value: 2,
              enabledAtMs: 1_000,
              inputAtMs: 1_300,
              inputKind: "pointer",
              trusted: true,
            },
            {
              round: 3,
              value: 4,
              enabledAtMs: 1_300,
              inputAtMs: 1_550,
              inputKind: "pointer",
              trusted: true,
            },
          ],
        },
      },
    ];

    for (const { mode, transcript } of cases) {
      const analysis = analyzeTimingEvidence(mode, transcript);
      expect(analysis.evidence.model, mode).toBe("observed-v2");
      expect(analysis.reviewSignals, mode).toEqual([]);
    }
  });
});
