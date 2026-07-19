import { describe, expect, it } from "vitest";
import { runXp } from "../src/xp.js";

describe("runXp (activity, not skill)", () => {
  it("awards one XP per question attempted, regardless of correctness", () => {
    const fifteen = { answers: Array.from({ length: 15 }, () => ({})) };
    expect(runXp(fifteen)).toBe(15);
    // Wrong answers earn exactly the same — XP measures practice, not skill.
    const withMisses = {
      answers: Array.from({ length: 15 }, () => ({ guesses: [1, 2, 3] })),
    };
    expect(runXp(withMisses)).toBe(15);
  });

  it("rewards longer sessions over shorter ones", () => {
    expect(
      runXp({ answers: Array.from({ length: 20 }, () => ({})) }),
    ).toBeGreaterThan(
      runXp({ answers: Array.from({ length: 8 }, () => ({})) }),
    );
  });

  it("falls back to attempts or picks for other transcript shapes", () => {
    expect(runXp({ attempts: [{}, {}, {}] })).toBe(3);
    expect(runXp({ picks: [{}, {}] })).toBe(2);
  });

  it("keeps a participation floor of one", () => {
    expect(runXp({})).toBe(1);
    expect(runXp({ answers: [] })).toBe(1);
  });
});
