import { describe, expect, it } from "vitest";
import {
  parseRecoveryArgs,
  planRainRecovery,
} from "../src/maintenance/recover-rain-runs.js";
import type { RunItem } from "../src/repository.js";
import type { EvidenceItem } from "../src/types.js";

const run: RunItem = {
  pk: "RUN#11111111-1111-4111-8111-111111111111",
  sk: "RUN",
  runId: "11111111-1111-4111-8111-111111111111",
  owner: "player-sub",
  mode: "rain",
  challenge: {
    mode: "rain",
    cardIds: [26000000, 26000001, 26000002, 26000003, 26000004],
  },
  state: "started",
  startedAt: "2026-08-07T12:00:00.000Z",
  expiresAt: 1_800_000_000,
  boardEpoch: "r3",
};

function evidence(): EvidenceItem {
  return {
    pk: "PLAYER#player-sub",
    sk: `EVIDENCE#2026-08-07T12:00:13.000Z#${run.runId}`,
    runId: run.runId,
    playerSub: run.owner,
    mode: "rain",
    seasonId: 135,
    runType: "unscored",
    integrityOutcome: "Rain continued past three lives",
    challenge: run.challenge,
    transcript: {
      answers: [
        { cardId: 26000000, guess: 3, atMs: 1_000, wrongGuesses: 1 },
        { cardId: 26000001, guess: null, atMs: 9_000, wrongGuesses: 0 },
        { cardId: 26000002, guess: null, atMs: 10_000, wrongGuesses: 0 },
        { cardId: 26000003, guess: null, atMs: 11_000, wrongGuesses: 0 },
        // Correct, but 50ms after the final life was spent. This is the client
        // race being repaired and must not survive into the canonical run.
        { cardId: 26000004, guess: 7, atMs: 11_050, wrongGuesses: 0 },
      ],
    },
    startedAt: run.startedAt,
    completedAt: "2026-08-07T12:00:13.000Z",
    wallElapsedMs: 13_000,
    scoringVersion: { web: "broken-build", rules: "5" },
    correlation: { complete: {} },
    schemaVersion: "1",
    expiresAt: 1_810_000_000,
  };
}

describe("Rain run recovery", () => {
  it("keeps every run spec when no explicit table flag is present", () => {
    expect(
      parseRecoveryArgs([
        "11111111-1111-4111-8111-111111111111=1",
        "22222222-2222-4222-8222-222222222222=2",
      ]).specs,
    ).toEqual([
      { runId: "11111111-1111-4111-8111-111111111111", expectedScore: 1 },
      { runId: "22222222-2222-4222-8222-222222222222", expectedScore: 2 },
    ]);
  });

  it("removes only the correct tap inside the terminal frame and re-scores", () => {
    const retained = evidence();
    const plan = planRainRecovery(retained, run, 1);

    expect(plan.score).toBe(1);
    // Rain score 1 is in the nuanced 0-4 anti-spam band: exact score XP.
    expect(plan.xp).toBe(1);
    expect(plan.answerCount).toBe(4);
    expect(plan.ignoredAnswerCount).toBe(1);
    expect(plan.terminalInputDelayMs).toBe(50);
    expect(plan.tiebreaks).toEqual({ wrongGuesses: 1, avgLatencyMs: 1_000 });
    expect(plan.transcript.answers).toHaveLength(4);
    expect(retained.transcript.answers).toHaveLength(5);
  });

  it("refuses a suffix that is not the one-answer 200ms client race", () => {
    const retained = evidence();
    const answers = retained.transcript.answers as Array<
      Record<string, unknown>
    >;
    answers[4] = { ...answers[4], atMs: 11_201 };
    expect(() => planRainRecovery(retained, run, 1)).toThrow(
      /outside the Rain terminal frame/,
    );

    const withTwoAnswers = evidence();
    (withTwoAnswers.transcript.answers as unknown[]).push({
      cardId: 26000000,
      guess: 3,
      atMs: 11_100,
      wrongGuesses: 0,
    });
    expect(() => planRainRecovery(withTwoAnswers, run, 1)).toThrow(
      /one-answer terminal race/,
    );
  });

  it("requires the independently expected canonical score", () => {
    expect(() => planRainRecovery(evidence(), run, 2)).toThrow(
      /does not match expected 2/,
    );
  });
});
