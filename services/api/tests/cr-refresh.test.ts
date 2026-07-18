import { describe, expect, it } from "vitest";
import { publicCrProfile, usesPlayerCollection } from "../src/cr-refresh.js";

describe("CR profile refresh policy", () => {
  it("uses the collection only for card-recognition modes", () => {
    expect(usesPlayerCollection("surge")).toBe(true);
    expect(usesPlayerCollection("practice")).toBe(true);
    expect(usesPlayerCollection("identify")).toBe(true);
    expect(usesPlayerCollection("trade")).toBe(false);
    expect(usesPlayerCollection("ladder")).toBe(false);
    expect(usesPlayerCollection("cost-sweep")).toBe(false);
  });

  it("returns an immediately useful pending profile before the bridge responds", () => {
    expect(publicCrProfile("#2PYQ0", undefined)).toEqual({
      tag: "#2PYQ0",
      status: "pending",
    });
  });
});
