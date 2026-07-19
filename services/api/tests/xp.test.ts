import { describe, expect, it } from "vitest";
import { runXp } from "../src/xp.js";

// A first-try answer (single guess) is the mastery signal for guess-until-right
// modes; extra guesses drop both the correct count and the accuracy multiplier.
function sprint(firstTry: number, retried: number) {
  return {
    answers: [
      ...Array.from({ length: firstTry }, () => ({ guesses: [3] })),
      ...Array.from({ length: retried }, () => ({ guesses: [2, 3] })),
    ],
  };
}

describe("runXp", () => {
  it("rewards a clean Surge run more than a sloppy one of the same length", () => {
    const clean = runXp("surge", 20_000, sprint(15, 0));
    const sloppy = runXp("surge", 40_000, sprint(5, 10));
    expect(clean).toBeGreaterThan(sloppy);
    // 15 first-try × weight 4 × full accuracy.
    expect(clean).toBe(60);
  });

  it("scales Practice by its accuracy percentage at a reduced weight", () => {
    const total = 10;
    const answers = { answers: Array.from({ length: total }, () => ({})) };
    // 80% of 10 = 8 correct, weight 2, accuracy 0.8 → 8·2·(0.5+0.4) = 14.4 → 14.
    expect(runXp("practice", 80, answers)).toBe(14);
    // A weaker session earns less.
    expect(runXp("practice", 80, answers)).toBeGreaterThan(
      runXp("practice", 30, answers),
    );
  });

  it("counts the correct streak for Higher/Lower and Survival", () => {
    const answers = { answers: Array.from({ length: 11 }, () => ({})) };
    // 10 correct before the miss, accuracy 10/11 ≈ 0.9545.
    expect(runXp("higher-lower", 10, answers)).toBe(29); // weight 3
    expect(runXp("survival", 10, answers)).toBe(38); // sudden-death weight 4
  });

  it("awards a participation floor when nothing parses", () => {
    expect(runXp("surge", 0, {})).toBe(1);
    expect(runXp("surge", 0, { answers: [] })).toBe(1);
  });

  it("never awards negative XP", () => {
    expect(runXp("higher-lower", -5, { answers: [{}] })).toBeGreaterThanOrEqual(
      1,
    );
  });
});
