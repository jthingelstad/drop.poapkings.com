import { describe, expect, it } from "vitest";
import type { GameMode, RunChallenge } from "@elixir-drop/contracts";
import { deriveRunShareVisual } from "../src/share-visual.js";
import type { EvidenceItem } from "../src/types.js";

function evidence(
  mode: GameMode,
  challenge: RunChallenge,
  answers: Array<Record<string, unknown>>,
  runType: EvidenceItem["runType"] = "ranked",
): EvidenceItem {
  return {
    pk: "PLAYER#sub",
    sk: "EVIDENCE#2026-08-23T00:00:00.000Z#run",
    runId: "run",
    playerSub: "sub",
    mode,
    seasonId: 135,
    runType,
    integrityOutcome: "accepted",
    challenge,
    transcript: { answers },
    startedAt: "2026-08-22T23:59:00.000Z",
    completedAt: "2026-08-23T00:00:00.000Z",
    wallElapsedMs: 60_000,
    scoringVersion: { rules: "test" },
    correlation: { complete: {} },
    schemaVersion: "1",
    expiresAt: 0,
  };
}

describe("server-owned run share visuals", () => {
  it("derives Surge per-card time with penalties and the player's prior-run reference", () => {
    const visual = deriveRunShareVisual(
      evidence("surge", { mode: "surge", cardIds: [26000000, 26000003] }, [
        { cardId: 26000000, guesses: [3], atMs: 1_000 },
        { cardId: 26000003, guesses: [3, 5], atMs: 3_000 },
      ]),
      {
        mode: "surge",
        unit: "SECONDS PER CARD",
        values: [800, 3_500],
      },
    );

    expect(visual).toEqual({
      mode: "surge",
      unit: "SECONDS PER CARD",
      values: [1_000, 4_000],
      refs: [800, 3_500],
      bad: [true, true],
    });
  });

  it("derives Trade and Higher / Lower without trusting a client chart", () => {
    expect(
      deriveRunShareVisual(
        evidence("trade", { mode: "trade", rounds: [] }, [
          { guesses: [1], atMs: 500 },
          { guesses: [1, 2], atMs: 1_200 },
        ]),
      ),
    ).toMatchObject({
      values: [500, 700],
      refs: [600, 600],
      bad: [false, true],
    });
    expect(
      deriveRunShareVisual(
        evidence(
          "higher-lower",
          { mode: "higher-lower", pairs: [[26000002, 26000003]] },
          [{ pickedId: 26000003, elapsedMs: 750 }],
        ),
      ),
    ).toMatchObject({ values: [750], bad: [false] });
  });

  it("bounds long Survival charts while preserving the fatal final answer", () => {
    const answers = Array.from({ length: 45 }, (_, index) => ({
      guess: index === 44 ? 9 : 3,
      elapsedMs: 500 + index,
    }));
    const visual = deriveRunShareVisual(
      evidence(
        "survival",
        {
          mode: "survival",
          cardIds: Array.from({ length: 45 }, () => 26000000),
        },
        answers,
      ),
    );

    expect(visual?.values).toHaveLength(30);
    expect(visual?.bad).toHaveLength(30);
    expect(visual?.bad?.at(-1)).toBe(true);
  });

  it("derives Rain life-loss bars and ignores non-ranked evidence", () => {
    expect(
      deriveRunShareVisual(
        evidence("rain", { mode: "rain", cardIds: [26000000, 26000003] }, [
          { cardId: 26000000, guess: 3, atMs: 600 },
          { cardId: 26000003, guess: null, atMs: 2_000 },
        ]),
      ),
    ).toMatchObject({ bad: [false, true] });
    expect(
      deriveRunShareVisual(
        evidence(
          "surge",
          { mode: "surge", cardIds: [26000000] },
          [{ guesses: [3], atMs: 500 }],
          "unscored",
        ),
      ),
    ).toBeUndefined();
  });
});
