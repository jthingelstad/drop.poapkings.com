import { describe, expect, it } from "vitest";
import { publicCrProfile } from "../src/cr-refresh.js";

describe("CR profile refresh policy", () => {
  it("returns an immediately useful pending profile before the bridge responds", () => {
    expect(publicCrProfile("#2PYQ0", undefined)).toEqual({
      tag: "#2PYQ0",
      status: "pending",
    });
  });
});
