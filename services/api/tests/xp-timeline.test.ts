import { describe, expect, it } from "vitest";
import { buildXpTimeline } from "../src/xp-timeline.js";

describe("XP timeline", () => {
  it("groups base runs and immutable awards by UTC day without double-counting run bonuses", () => {
    const timeline = buildXpTimeline(
      130,
      [
        {
          completedAt: "2026-08-23T01:00:00.000Z",
          xp: 60,
          xpAwards: [
            { source: "game", label: "Rain completion", amount: 35 },
            { source: "badge", label: "Badge milestone", amount: 25 },
          ],
        },
        {
          completedAt: "2026-08-23T02:00:00.000Z",
          xp: 20,
          xpAwards: [
            { source: "practice", label: "Practice cards", amount: 10 },
            { source: "personal-best", label: "New personal best", amount: 10 },
          ],
        },
        {
          completedAt: "2026-08-20T23:00:00.000Z",
          xp: 16,
        },
      ],
      [
        {
          awardedAt: "2026-08-23T01:00:00.000Z",
          award: { source: "badge", label: "Badge milestone", amount: 25 },
        },
        {
          awardedAt: "2026-08-23T02:00:00.000Z",
          award: {
            source: "personal-best",
            label: "New personal best",
            amount: 10,
          },
        },
        {
          awardedAt: "2026-08-23T03:00:00.000Z",
          award: {
            source: "daily-featured",
            label: "Daily featured game",
            amount: 5,
          },
        },
      ],
    );

    expect(timeline).toEqual({
      totalXp: 130,
      attributedXp: 101,
      openingBalance: 29,
      timeZone: "UTC",
      days: [
        {
          date: "2026-08-23",
          xp: 85,
          events: 5,
          sources: [
            { source: "game", xp: 35, events: 1 },
            { source: "practice", xp: 10, events: 1 },
            { source: "personal-best", xp: 10, events: 1 },
            { source: "daily-featured", xp: 5, events: 1 },
            { source: "badge", xp: 25, events: 1 },
          ],
        },
        {
          date: "2026-08-20",
          xp: 16,
          events: 1,
          sources: [{ source: "legacy-run", xp: 16, events: 1 }],
        },
      ],
    });
  });

  it("rejects an impossible ledger that exceeds the lifetime profile total", () => {
    expect(() =>
      buildXpTimeline(
        4,
        [{ completedAt: "2026-08-23T00:00:00.000Z", xp: 5 }],
        [],
      ),
    ).toThrow("Attributed XP exceeds");
  });
});
