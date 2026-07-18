import { describe, expect, it } from "vitest";
import { favoriteCard } from "../src/cards.js";
import { fallbackNamesForCard, isSafeFavoriteCardName } from "../src/names.js";
import { normalizeEmail, normalizePlayerTag } from "../src/validation.js";

describe("player input validation", () => {
  it("normalizes identity fields", () => {
    expect(normalizeEmail(" Player@Example.COM ")).toBe("player@example.com");
    expect(normalizePlayerTag(" 2pyq0 ")).toBe("#2PYQ0");
  });

  it("only permits names bound to the selected card", () => {
    expect(isSafeFavoriteCardName("Royal Ghost", "Royal Ghost")).toBe(true);
    expect(isSafeFavoriteCardName("Royal Ghost Main", "Royal Ghost")).toBe(
      true,
    );
    expect(isSafeFavoriteCardName("Team Royal Ghost", "Royal Ghost")).toBe(
      true,
    );
    expect(isSafeFavoriteCardName("Royal Giant Main", "Royal Ghost")).toBe(
      false,
    );
    expect(
      isSafeFavoriteCardName("Royal Ghost definitelybadword", "Royal Ghost"),
    ).toBe(false);
  });

  it("builds deterministic fallback choices around one card", () => {
    expect(fallbackNamesForCard("P.E.K.K.A")).toEqual([
      "P.E.K.K.A",
      "P.E.K.K.A Main",
      "P.E.K.K.A Ace",
      "Team P.E.K.K.A",
      "P.E.K.K.A Legend",
      "P.E.K.K.A Fan",
    ]);
  });

  it("only accepts cards in the canonical catalog", () => {
    expect(favoriteCard(26000000)).toEqual({ id: 26000000, name: "Knight" });
    expect(favoriteCard(99999999)).toBeUndefined();
    expect(favoriteCard("26000000")).toBeUndefined();
  });
});
