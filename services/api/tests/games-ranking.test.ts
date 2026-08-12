import { describe, expect, it } from "vitest";
import { isStrictlyBetterPerformance } from "../src/games.js";

describe("strict all-time leader comparison", () => {
  it("holds only a genuinely faster Surge score", () => {
    const current = { score: 10_000 };
    expect(
      isStrictlyBetterPerformance("surge", 9_999, undefined, current),
    ).toBe(true);
    expect(
      isStrictlyBetterPerformance("surge", 10_000, undefined, current),
    ).toBe(false);
  });

  it("uses ordered mode tiebreaks but ignores timestamp tie ordering", () => {
    const survivalLeader = { score: 40, timeMs: 20_000 };
    expect(
      isStrictlyBetterPerformance(
        "survival",
        40,
        { timeMs: 19_999 },
        survivalLeader,
      ),
    ).toBe(true);
    expect(
      isStrictlyBetterPerformance(
        "survival",
        40,
        { timeMs: 20_000 },
        survivalLeader,
      ),
    ).toBe(false);

    const higherLowerLeader = {
      score: 80,
      livesLost: 2,
      timeMs: 30_000,
    };
    expect(
      isStrictlyBetterPerformance(
        "higher-lower",
        80,
        { livesLost: 1, timeMs: 40_000 },
        higherLowerLeader,
      ),
    ).toBe(true);
  });
});
