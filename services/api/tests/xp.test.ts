import {
  BADGE_LIST,
  badgeRungXp,
  featuredModeForDate,
  practiceXpForCards,
  seasonPlacementXp,
} from "@elixir-drop/contracts";
import { describe, expect, it } from "vitest";
import { runXp } from "../src/xp.js";

describe("Player XP v2", () => {
  it("pays fixed completion XP for Surge and the harder Trade run", () => {
    expect(runXp("surge", 99_000)).toBe(15);
    expect(runXp("trade", 99_000)).toBe(100);
  });

  it.each([
    ["higher-lower", 0, 0],
    ["higher-lower", 4, 4],
    ["higher-lower", 5, 10],
    ["higher-lower", 19, 20],
    ["higher-lower", 20, 40],
    ["higher-lower", 39, 60],
    ["higher-lower", 49, 75],
    ["higher-lower", 69, 90],
    ["higher-lower", 99, 110],
    ["higher-lower", 100, 125],
    ["survival", 4, 4],
    ["survival", 5, 10],
    ["survival", 39, 40],
    ["survival", 59, 60],
    ["survival", 79, 90],
    ["survival", 99, 100],
    ["survival", 119, 110],
    ["survival", 120, 125],
    ["rain", 4, 4],
    ["rain", 5, 10],
    ["rain", 24, 20],
    ["rain", 39, 40],
    ["rain", 54, 60],
    ["rain", 69, 75],
    ["rain", 99, 90],
    ["rain", 134, 110],
    ["rain", 135, 125],
  ] as const)("pays %s score %i as %i XP", (mode, score, xp) => {
    expect(runXp(mode, score)).toBe(xp);
  });

  it("carries an odd Practice card between unlimited sessions", () => {
    expect(practiceXpForCards(1)).toEqual({ xp: 0, carriedCards: 1 });
    expect(practiceXpForCards(1, 1)).toEqual({ xp: 1, carriedCards: 0 });
    expect(practiceXpForCards(101)).toEqual({ xp: 50, carriedCards: 1 });
  });

  it("rotates the same featured mode for every player on a UTC day", () => {
    expect(featuredModeForDate(new Date("2026-08-21T00:00:00Z"))).toBe(
      featuredModeForDate(new Date("2026-08-21T23:59:59Z")),
    );
  });

  it.each([
    [0, 0],
    [1, 500],
    [2, 350],
    [3, 250],
    [4, 150],
    [5, 150],
    [6, 100],
    [10, 100],
    [11, 50],
    [20, 50],
    [21, 0],
  ])("pays season rank %i as %i XP", (rank, xp) => {
    expect(seasonPlacementXp(rank)).toBe(xp);
  });

  it("derives visible, hidden, and Collector rung XP from badge definitions", () => {
    const visible = BADGE_LIST.find((badge) => badge.slug === "surge-runner")!;
    const hidden = BADGE_LIST.find(
      (badge) => badge.hidden && badge.slug !== "collector",
    )!;
    const collector = BADGE_LIST.find((badge) => badge.slug === "collector")!;
    const visibleXp = visible.rungs.map((_, index) =>
      badgeRungXp(visible, index),
    );
    expect(visibleXp).toContain(5);
    expect(visibleXp).toContain(50);
    expect(badgeRungXp(hidden, 0)).toBe(25);
    expect(badgeRungXp(collector, 0)).toBe(100);
  });
});
