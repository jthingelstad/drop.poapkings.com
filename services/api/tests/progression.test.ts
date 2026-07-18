import { describe, expect, it } from "vitest";
import { gamesRequiredForLevel, levelForGames } from "../src/progression.js";

describe("player progression", () => {
  it("uses a gradually increasing triangular curve", () => {
    expect([1, 2, 3, 4, 5].map(gamesRequiredForLevel)).toEqual([
      0, 5, 15, 30, 50,
    ]);
  });

  it("reports current and next thresholds", () => {
    expect(levelForGames(14)).toEqual({
      level: 2,
      levelStartGames: 5,
      nextLevelGames: 15,
    });
    expect(levelForGames(15)).toEqual({
      level: 3,
      levelStartGames: 15,
      nextLevelGames: 30,
    });
  });
});
