import { describe, expect, it } from "vitest";
import {
  higherLowerWindowMs,
  rainSpawnFloorMs,
  rainSpawnIntervalMs,
  survivalWindowMs,
} from "@elixir-drop/contracts";

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

  it("keeps Higher/Lower on Survival's tightening curve without a plateau", () => {
    for (const round of [0, 4, 10, 25, 26, 119, 249]) {
      expect(higherLowerWindowMs(round)).toBe(survivalWindowMs(round));
    }
    expect(higherLowerWindowMs(0)).toBe(5_000);
    expect(higherLowerWindowMs(25)).toBe(2_000);
    expect(higherLowerWindowMs(26)).toBeLessThan(2_000);
    expect(higherLowerWindowMs(249)).toBeGreaterThan(800);

    // Higher/Lower can present all 250 signed pairs. Millisecond rounding can
    // make two adjacent deep rounds equal, but the window never grows and keeps
    // dropping across the full deal instead of settling on the old 2s floor.
    for (let round = 1; round < 250; round += 1) {
      expect(higherLowerWindowMs(round)).toBeLessThanOrEqual(
        higherLowerWindowMs(round - 1),
      );
    }
    for (let round = 10; round < 250; round += 10) {
      expect(higherLowerWindowMs(round)).toBeLessThan(
        higherLowerWindowMs(round - 10),
      );
    }
  });

  it("matches Rain's documented spawn cadence", () => {
    expect(Math.round(rainSpawnIntervalMs(0))).toBe(1_160);
    expect(Math.round(rainSpawnIntervalMs(50))).toBe(710);
    expect(Math.round(rainSpawnIntervalMs(200))).toBe(440);

    // Always positive and always tightening: the gap closes forever without ever
    // reaching its floor, which is what makes Rain endless but not survivable.
    for (let cleared = 1; cleared <= 1_000; cleared += 1) {
      expect(rainSpawnIntervalMs(cleared)).toBeLessThan(
        rainSpawnIntervalMs(cleared - 1),
      );
      expect(rainSpawnIntervalMs(cleared)).toBeGreaterThan(260);
    }
  });

  it("computes Rain's minimum-time floor from the spawn curve alone", () => {
    // Hand-checked against sum(260 + 900 / (1 + 0.02n)) for n = 0 … N-1. These
    // are the numbers GAMES.md quotes, and they are the whole reason Rain is
    // bounded: below them, a score is not a thing a human could have played.
    expect(rainSpawnFloorMs(0)).toBe(0);
    expect(rainSpawnFloorMs(1)).toBe(1_160);
    expect(rainSpawnFloorMs(10)).toBe(10_880);
    expect(rainSpawnFloorMs(50)).toBe(44_418);
    expect(rainSpawnFloorMs(100)).toBe(75_739);
    expect(rainSpawnFloorMs(200)).toBe(124_786);

    // It is exactly the running sum of the shared curve — the scorer walks the
    // transcript accumulating the same additions in the same order rather than
    // re-summing per answer, so the two must agree to the millisecond.
    let running = 0;
    for (let gaps = 0; gaps <= 300; gaps += 1) {
      expect(rainSpawnFloorMs(gaps)).toBe(Math.round(running));
      running += rainSpawnIntervalMs(gaps);
    }
  });
});
