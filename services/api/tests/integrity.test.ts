import { describe, expect, it } from "vitest";
import { rainSpawnFloorMs } from "@elixir-drop/contracts";
import { MODE_RULES } from "../src/games.js";
import { assessRunIntegrity } from "../src/integrity.js";
import { RAIN_FLOOR_TOLERANCE_MS, RAIN_MAX_ANSWERS } from "../src/scoring.js";

describe("competition integrity check", () => {
  it("rejects timed scores below the shipped UI floor", () => {
    expect(assessRunIntegrity("surge", 4_499, 10_000)).toEqual({
      eligible: false,
      reason: "score_below_ui_floor",
    });
    expect(assessRunIntegrity("surge", 4_500, 10_000)).toEqual({
      eligible: true,
    });
  });

  // The ladder forces a 280ms beat between correct rounds, so nine beats put a
  // legal 10-round run at 2,520ms before any thinking. A floor below that could
  // never fire; this pins it above the forced-beat total so the check keeps
  // meaning something if the ladder length or the beat ever changes.
  it("keeps Trade's floor above the ladder's own forced beats", () => {
    const forcedBeatsMs = 9 * 280;
    expect(assessRunIntegrity("trade", forcedBeatsMs, 10_000)).toEqual({
      eligible: false,
      reason: "score_below_ui_floor",
    });
    expect(assessRunIntegrity("trade", 2_999, 10_000)).toEqual({
      eligible: false,
      reason: "score_below_ui_floor",
    });
    expect(assessRunIntegrity("trade", 3_000, 10_000)).toEqual({
      eligible: true,
    });
  });

  it("rejects continuous-mode completion rates that bypass UI delays", () => {
    expect(assessRunIntegrity("higher-lower", 20, 10_000)).toEqual({
      eligible: false,
      reason: "completion_rate_above_ui_limit",
    });
  });

  it("rejects scores outside the mode's accepted range", () => {
    expect(assessRunIntegrity("survival", 100_001, 60_000)).toEqual({
      eligible: false,
      reason: "score_out_of_range",
    });
    expect(assessRunIntegrity("surge", 999, 10_000)).toEqual({
      eligible: false,
      reason: "score_out_of_range",
    });
  });

  it("keeps practice honest at any wall time — only its score range matters", () => {
    // Practice is unranked and only drives XP, so it has no wall-time floor.
    expect(assessRunIntegrity("practice", 100, 1_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("practice", 100, 20_000)).toEqual({
      eligible: true,
    });
  });

  // Rain has no round length and no clock, so the spawn curve is the only thing
  // that bounds it: a tile cannot be cleared before it spawns. Measured here
  // against the server's own wall clock, which is the one number in a completion
  // no client can write.
  it("holds a Rain score the wall clock is too short to contain", () => {
    // 100 clears cannot happen in under 75.7s of spawn gaps, tolerance aside.
    expect(assessRunIntegrity("rain", 100, 30_000)).toEqual({
      eligible: false,
      reason: "completion_rate_above_ui_limit",
    });
    // Exactly on the boundary: the floor, less the tolerance, is eligible.
    const floorMs = rainSpawnFloorMs(100);
    expect(
      assessRunIntegrity("rain", 100, floorMs - RAIN_FLOOR_TOLERANCE_MS),
    ).toEqual({ eligible: true });
    expect(
      assessRunIntegrity("rain", 100, floorMs - RAIN_FLOOR_TOLERANCE_MS - 1),
    ).toEqual({ eligible: false, reason: "completion_rate_above_ui_limit" });
    // A deep, slow, honest run is untouched — as is a zero-score attempt, whose
    // floor is zero.
    expect(assessRunIntegrity("rain", 240, 600_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("rain", 0, 4_000)).toEqual({ eligible: true });
  });

  it("keeps Rain's score ceiling inside the scorer's transcript ceiling", () => {
    // The scorer refuses a longer transcript than RAIN_MAX_ANSWERS and the score
    // can never exceed the cards resolved, so a higher ceiling here could never
    // fire on anything the scorer would accept.
    expect(MODE_RULES.rain.maxScore).toBe(RAIN_MAX_ANSWERS);
    expect(
      assessRunIntegrity("rain", RAIN_MAX_ANSWERS + 1, 60_000_000),
    ).toEqual({ eligible: false, reason: "score_out_of_range" });
  });

  it("leaves ordinary and boundary scores eligible", () => {
    expect(assessRunIntegrity("higher-lower", 20, 30_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("survival", 250, 90_000)).toEqual({
      eligible: true,
    });
  });
});
