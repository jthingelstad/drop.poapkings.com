import { describe, expect, it } from "vitest";
import { seasonForDate, upcomingSeasons } from "../src/seasons.js";

describe("Clan Wars seasons", () => {
  it("starts at 10:00 UTC on the first Monday and can span five weeks", () => {
    expect(seasonForDate(new Date("2026-08-15T12:00:00Z"))).toEqual({
      id: "2026-08",
      startsAt: "2026-08-03T10:00:00.000Z",
      endsAt: "2026-09-07T10:00:00.000Z",
      durationWeeks: 5,
      source: "calendar-fallback",
      currentWeek: 2,
      daysRemainingInWeek: 2,
    });
  });

  it("uses a fresh bridge clock for the CR season and current war week", () => {
    expect(
      seasonForDate(new Date("2026-07-18T19:00:00.000Z"), {
        crSeasonId: 134,
        sectionIndex: 1,
        periodIndex: 12,
        periodType: "warDay",
        seasonStartsAt: "2026-07-06T10:00:00.000Z",
        observedAt: "2026-07-18T18:55:00.000Z",
        sourceClanTag: "#J2RGCRVG",
        leaderboardSeasonId: "2026-07",
        updatedAt: "2026-07-18T18:55:00.000Z",
      }),
    ).toEqual({
      id: "2026-07",
      startsAt: "2026-07-06T10:00:00.000Z",
      endsAt: "2026-08-03T10:00:00.000Z",
      durationWeeks: 4,
      source: "clash-royale",
      crSeasonId: 134,
      currentWeek: 2,
      daysRemainingInWeek: 2,
      periodType: "warDay",
      clockUpdatedAt: "2026-07-18T18:55:00.000Z",
    });
  });

  it("falls back to the UTC calendar when the bridge clock is stale", () => {
    const season = seasonForDate(new Date("2026-07-18T19:00:00.000Z"), {
      crSeasonId: 134,
      sectionIndex: 1,
      periodIndex: 12,
      periodType: "warDay",
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: "2026-07-18T12:00:00.000Z",
      sourceClanTag: "#J2RGCRVG",
      leaderboardSeasonId: "2026-07",
      updatedAt: "2026-07-18T12:00:00.000Z",
    });

    expect(season.source).toBe("calendar-fallback");
    expect(season.crSeasonId).toBeUndefined();
  });

  it("keeps the previous season until the exact reset instant", () => {
    expect(seasonForDate(new Date("2026-09-07T09:59:59Z")).id).toBe("2026-08");
    expect(seasonForDate(new Date("2026-09-07T10:00:00Z")).id).toBe("2026-09");
  });

  it("returns consecutive boundaries", () => {
    const seasons = upcomingSeasons(new Date("2026-07-17T00:00:00Z"), 2);
    expect(seasons[0]?.endsAt).toBe(seasons[1]?.startsAt);
  });
});
