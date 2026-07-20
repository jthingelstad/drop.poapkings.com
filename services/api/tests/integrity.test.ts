import { describe, expect, it } from "vitest";
import { assessRunIntegrity } from "../src/integrity.js";

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

  it("leaves ordinary and boundary scores eligible", () => {
    expect(assessRunIntegrity("higher-lower", 20, 30_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("survival", 250, 90_000)).toEqual({
      eligible: true,
    });
  });
});
