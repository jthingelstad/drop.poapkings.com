import { describe, expect, it } from "vitest";
import { GAME_MODES } from "@elixir-drop/contracts";
import { favoriteCard } from "../src/cards.js";
import { isSafeGeneratedName } from "../src/names.js";
import {
  normalizeAuthReturnPath,
  normalizeEmail,
  normalizePlayerTag,
} from "../src/validation.js";

describe("player input validation", () => {
  it("normalizes identity fields", () => {
    expect(normalizeEmail(" Player@Example.COM ")).toBe("player@example.com");
    expect(normalizePlayerTag(" 2pyq0 ")).toBe("#2PYQ0");
    // CR tags never contain the letter O; the game reads it as a zero, so a
    // tag copied from a screenshot must resolve rather than reject.
    expect(normalizePlayerTag("2PYQO")).toBe("#2PYQ0");
    expect(() => normalizePlayerTag("abc!")).toThrow(
      "Enter a valid Clash Royale player tag",
    );
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

  it("only carries exact approved routes through magic-link authentication", () => {
    expect(normalizeAuthReturnPath("/surge")).toBe("/surge");
    expect(normalizeAuthReturnPath("/profile?edit=player-tag")).toBe(
      "/profile?edit=player-tag",
    );
    expect(normalizeAuthReturnPath("/profile")).toBeUndefined();
    expect(
      normalizeAuthReturnPath("/profile?edit=player-tag&next=/admin"),
    ).toBeUndefined();
    expect(normalizeAuthReturnPath("/leaderboards")).toBeUndefined();
    expect(normalizeAuthReturnPath("https://example.com")).toBeUndefined();
    expect(normalizeAuthReturnPath("//evil.example.com")).toBeUndefined();
    expect(normalizeAuthReturnPath("/surge?next=/admin")).toBeUndefined();
    expect(normalizeAuthReturnPath(42)).toBeUndefined();
    expect(normalizeAuthReturnPath("")).toBeUndefined();
  });

  // The allowlist is derived from GAME_MODES rather than restated, so this is
  // the guard that the derivation still covers every shipped mode: a new mode
  // must be returnable, and a retired one must stop being.
  it.each(GAME_MODES)("carries every shipped mode home: %s", (mode) => {
    expect(normalizeAuthReturnPath(`/${mode}`)).toBe(`/${mode}`);
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
      "Midladder Menace",
      "P2W Pekka",
    ]) {
      expect(isSafeGeneratedName(name)).toBe(false);
    }
  });

  it("only accepts cards in the canonical catalog", () => {
    expect(favoriteCard(26000000)).toEqual({ id: 26000000, name: "Knight" });
    expect(favoriteCard(99999999)).toBeUndefined();
    expect(favoriteCard("26000000")).toBeUndefined();
  });
});
