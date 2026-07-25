import { describe, expect, it } from "vitest";
import { higherLowerWindowMs, survivalWindowMs } from "@elixir-drop/contracts";

// The shared difficulty curves drive the browser clock, the server scorer, and
// every mechanic claim in GAMES.md. Nothing pinned them before, which is how the
// docs came to say Survival drops below 2s "around a 40 streak" when it does so
// at 26 — a claim that materially understated the mode's difficulty to anyone
// reading the spec. These assertions are the documented numbers; if a curve
// changes deliberately, update GAMES.md and the contracts comment in the same
// commit.
describe("shared mode difficulty curves", () => {
  it("matches Survival's documented thresholds", () => {
    expect(survivalWindowMs(0)).toBe(5_000);
    expect(survivalWindowMs(25)).toBe(2_000);
    expect(survivalWindowMs(119)).toBe(1_126);

    const firstUnder = (limit: number) => {
      for (let streak = 0; streak <= 119; streak += 1) {
        if (survivalWindowMs(streak) < limit) return streak;
      }
      return undefined;
    };
    expect(firstUnder(3_000)).toBe(10);
    expect(firstUnder(2_000)).toBe(26);

    // Monotonically tightening across the whole reachable deck — the curve must
    // never flatten outright, even though its back half tightens only slightly.
    for (let streak = 1; streak <= 119; streak += 1) {
      expect(survivalWindowMs(streak)).toBeLessThan(
        survivalWindowMs(streak - 1),
      );
    }
  });

  it("matches Higher/Lower's documented clock, including where it floors", () => {
    expect(higherLowerWindowMs(0)).toBe(5_000);
    expect(higherLowerWindowMs(4)).toBe(4_000);

    const floored = (() => {
      for (let round = 0; round <= 250; round += 1) {
        if (higherLowerWindowMs(round) === 2_000) return round;
      }
      return undefined;
    })();
    // The clock stops tightening at round 12 and holds its 2s floor from there.
    // Difficulty past this point comes from the pair-gap ramp, not the clock.
    expect(floored).toBe(12);
    expect(higherLowerWindowMs(250)).toBe(2_000);
  });
});
