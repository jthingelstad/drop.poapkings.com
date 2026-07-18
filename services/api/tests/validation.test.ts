import { describe, expect, it } from "vitest";
import { isSafeCardName } from "../src/names.js";
import { normalizeEmail, normalizePlayerTag } from "../src/validation.js";

describe("player input validation", () => {
  it("normalizes identity fields", () => {
    expect(normalizeEmail(" Player@Example.COM ")).toBe("player@example.com");
    expect(normalizePlayerTag(" 2pyq0 ")).toBe("#2PYQ0");
  });

  it("only permits public names made from card-title words", () => {
    expect(isSafeCardName("Royal Ghost")).toBe(true);
    expect(isSafeCardName("Royal definitelybadword")).toBe(false);
  });
});
