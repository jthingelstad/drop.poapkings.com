import { describe, expect, it } from "vitest";
import { favoriteCard } from "../src/cards.js";
import {
  fallbackNamesForCard,
  isSafeGeneratedName,
  parseModelNames,
} from "../src/names.js";
import {
  normalizeEmail,
  normalizeGameReturnPath,
  normalizePlayerTag,
} from "../src/validation.js";

describe("player input validation", () => {
  it("normalizes identity fields", () => {
    expect(normalizeEmail(" Player@Example.COM ")).toBe("player@example.com");
    expect(normalizePlayerTag(" 2pyq0 ")).toBe("#2PYQ0");
  });

  it.each([
    "e***@p***.com",
    "player@example",
    "player@-example.com",
    "player@example..com",
    ".player@example.com",
    "player..one@example.com",
  ])("rejects incomplete or malformed email addresses: %s", (email) => {
    expect(() => normalizeEmail(email)).toThrow();
  });

  it("only carries game routes through magic-link authentication", () => {
    expect(normalizeGameReturnPath("/surge")).toBe("/surge");
    expect(normalizeGameReturnPath("/leaderboards")).toBeUndefined();
    expect(normalizeGameReturnPath("https://example.com")).toBeUndefined();
  });

  it("allows creative card-inspired names without requiring the exact title", () => {
    expect(isSafeGeneratedName("Skarmy Picnic")).toBe(true);
    expect(isSafeGeneratedName("Mini P Pancakes")).toBe(true);
    expect(isSafeGeneratedName("Pancake Patrol")).toBe(true);
    expect(isSafeGeneratedName("Bone Parade")).toBe(true);
  });

  it("rejects unsafe, identifying, or impersonating generated names", () => {
    for (const name of [
      "Supercell Support",
      "Goblin Admin",
      "Skarmy@home",
      "https Pekka",
      "Mini P   Party",
      "DefinitelyShitty",
    ]) {
      expect(isSafeGeneratedName(name)).toBe(false);
    }
  });

  it("filters and deduplicates model output", () => {
    expect(
      parseModelNames(
        '```json\n{"names":["Skarmy Picnic","skarmy picnic","Bone Parade","Supercell Support"]}\n```',
      ),
    ).toEqual(["Skarmy Picnic", "Bone Parade"]);
  });

  it("builds playful deterministic fallback choices with card nicknames", () => {
    expect(fallbackNamesForCard("Skeleton Army")).toEqual([
      "Skarmy",
      "Skarmy Energy",
      "Pocket Skarmy",
      "Skarmy Parade",
      "Skarmy Quest",
      "Skarmy Snack Club",
    ]);
  });

  it("only accepts cards in the canonical catalog", () => {
    expect(favoriteCard(26000000)).toEqual({ id: 26000000, name: "Knight" });
    expect(favoriteCard(99999999)).toBeUndefined();
    expect(favoriteCard("26000000")).toBeUndefined();
  });
});
