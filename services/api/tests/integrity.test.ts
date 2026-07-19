import { describe, expect, it } from "vitest";
import { assessRunIntegrity } from "../src/integrity.js";

describe("competition integrity review", () => {
  it("quarantines timed scores below the shipped UI floor", () => {
    expect(assessRunIntegrity("surge", 4_499, 10_000)).toEqual({
      eligible: false,
      reason: "score_below_ui_floor",
    });
    expect(assessRunIntegrity("surge", 4_500, 10_000)).toEqual({
      eligible: true,
    });
  });

  it("quarantines continuous-mode completion rates that bypass UI delays", () => {
    expect(assessRunIntegrity("practice", 100, 13_999)).toMatchObject({
      eligible: false,
    });
    expect(assessRunIntegrity("higher-lower", 20, 10_000)).toMatchObject({
      eligible: false,
    });
    expect(assessRunIntegrity("endless-ladder", 50, 3_000)).toMatchObject({
      eligible: false,
    });
  });

  it("quarantines scores outside the mode's accepted range", () => {
    expect(assessRunIntegrity("blitz", 10_001, 60_000)).toEqual({
      eligible: false,
      reason: "score_out_of_range",
    });
    expect(assessRunIntegrity("surge", 999, 10_000)).toEqual({
      eligible: false,
      reason: "score_out_of_range",
    });
  });

  it("names the practice floor for what it measures", () => {
    expect(assessRunIntegrity("practice", 100, 13_999)).toEqual({
      eligible: false,
      reason: "wall_time_below_ui_floor",
    });
  });

  it("leaves ordinary and boundary scores eligible", () => {
    expect(assessRunIntegrity("practice", 100, 20_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("higher-lower", 20, 30_000)).toEqual({
      eligible: true,
    });
    expect(assessRunIntegrity("survival", 250, 90_000)).toEqual({
      eligible: true,
    });
  });
});
