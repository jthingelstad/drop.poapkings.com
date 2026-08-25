import { describe, expect, it } from "vitest";
import {
  FIRST_DROP_LEGACY_COUNT,
  FIRST_DROP_LEGACY_CUTOFF,
  FIRST_DROP_LIMIT,
  hasFirstDropBadge,
} from "../src/first-drop.js";

describe("First Drop legacy boundary", () => {
  it("recognizes the measured rollout population without exposing an ordinal", () => {
    expect(FIRST_DROP_LEGACY_COUNT).toBe(25);
    expect(FIRST_DROP_LIMIT).toBe(100);
    expect(hasFirstDropBadge({ createdAt: FIRST_DROP_LEGACY_CUTOFF })).toBe(
      true,
    );
    expect(hasFirstDropBadge({ createdAt: "2026-08-17T01:12:31.013Z" })).toBe(
      false,
    );
  });

  it("prefers the durable allocation marker after the legacy boundary", () => {
    expect(
      hasFirstDropBadge({
        createdAt: "2026-08-25T12:00:00.000Z",
        firstDrop: true,
      }),
    ).toBe(true);
    expect(hasFirstDropBadge({ firstDrop: false })).toBe(false);
  });
});
