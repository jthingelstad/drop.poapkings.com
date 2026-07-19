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

  it("keeps the stored leaderboard season while a stale clock's season runs", () => {
    // A >2h bridge outage mid-season must not re-bucket completions into a
    // calendar-derived id — that split the leaderboard around every outage.
    const season = seasonForDate(new Date("2026-07-18T19:00:00.000Z"), {
      crSeasonId: 134,
      sectionIndex: 1,
      periodIndex: 12,
      periodType: "warDay",
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: "2026-07-18T12:00:00.000Z",
      sourceClanTag: "#J2RGCRVG",
      leaderboardSeasonId: "2026-07-134",
      updatedAt: "2026-07-18T12:00:00.000Z",
    });

    expect(season.source).toBe("calendar-fallback");
    expect(season.id).toBe("2026-07-134");
    expect(season.crSeasonId).toBe(134);
    expect(season.currentWeek).toBe(2);
    expect(season.clockUpdatedAt).toBe("2026-07-18T12:00:00.000Z");
  });

  it("carries a stale clock through a fifth week and then lets go", () => {
    const clock = {
      crSeasonId: 134,
      sectionIndex: 4,
      periodIndex: 30,
      periodType: "warDay" as const,
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: "2026-08-03T09:00:00.000Z",
      sourceClanTag: "#J2RGCRVG",
      leaderboardSeasonId: "2026-07",
      updatedAt: "2026-08-03T09:00:00.000Z",
    };
    // Week 5 of a five-week season: the calendar alone would have flipped to
    // 2026-08 on August 3rd, vanishing outage-window runs from the board.
    const carried = seasonForDate(new Date("2026-08-06T12:00:00.000Z"), clock);
    expect(carried.id).toBe("2026-07");
    expect(carried.currentWeek).toBe(5);
    // Five weeks after the observed season start the clock cannot describe
    // the current season; the calendar takes over.
    const released = seasonForDate(new Date("2026-08-11T12:00:00.000Z"), clock);
    expect(released.id).toBe("2026-08");
    expect(released.crSeasonId).toBeUndefined();
  });

  it("extends a live clock's season end once a fifth week is observed", () => {
    const season = seasonForDate(new Date("2026-08-04T12:00:00.000Z"), {
      crSeasonId: 134,
      sectionIndex: 4,
      periodIndex: 29,
      periodType: "warDay",
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: "2026-08-04T11:30:00.000Z",
      sourceClanTag: "#J2RGCRVG",
      leaderboardSeasonId: "2026-07",
      updatedAt: "2026-08-04T11:30:00.000Z",
    });
    expect(season.source).toBe("clash-royale");
    expect(season.endsAt).toBe("2026-08-10T10:00:00.000Z");
    expect(season.durationWeeks).toBe(5);
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
