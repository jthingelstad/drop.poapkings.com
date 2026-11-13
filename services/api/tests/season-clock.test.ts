import { describe, expect, it } from "vitest";
import { policyClock } from "../src/season-clock.js";
import { seasonForDate } from "../src/seasons.js";

// Drop computes the season clock itself (Jamie, 2026-11-13: Drop talks to
// Elixir only to sign people in). These are the answers Elixir's game clock
// gave for the same instants, so nothing a player sees moved with it.
describe("Drop's own season clock", () => {
  it("answers what Elixir's policy clock answered on a training day", () => {
    expect(policyClock(new Date("2026-09-08T12:00:00Z"))).toEqual({
      crSeasonId: 136,
      sectionIndex: 0,
      periodIndex: 1,
      periodType: "training",
      seasonStartsAt: "2026-09-07T10:00:00.000Z",
      seasonEndsAt: "2026-10-05T10:00:00.000Z",
      dayStartsAt: "2026-09-08T10:00:00.000Z",
      dayEndsAt: "2026-09-09T10:00:00.000Z",
      observedAt: "2026-09-08T12:00:00.000Z",
      clockSource: "policy",
    });
  });

  it("names war days, and Colosseum only in a season's last week", () => {
    // S135 is five weeks (2026-08-03 -> 2026-09-07); Thursday of week 2.
    expect(policyClock(new Date("2026-08-13T11:00:00Z"))).toMatchObject({
      crSeasonId: 135,
      sectionIndex: 1,
      periodIndex: 10,
      periodType: "warDay",
    });
    // Thursday of week 5 is Colosseum; its Monday is still training.
    expect(policyClock(new Date("2026-09-03T11:00:00Z"))).toMatchObject({
      crSeasonId: 135,
      sectionIndex: 4,
      periodIndex: 31,
      periodType: "colosseum",
    });
    expect(policyClock(new Date("2026-08-31T11:00:00Z"))).toMatchObject({
      sectionIndex: 4,
      periodType: "training",
    });
  });

  it("rolls the season and the day at 10:00 UTC, never earlier", () => {
    const before = policyClock(new Date("2026-10-05T09:59:59Z"));
    expect(before).toMatchObject({
      crSeasonId: 136,
      sectionIndex: 3,
      periodIndex: 27,
      periodType: "colosseum",
      dayEndsAt: "2026-10-05T10:00:00.000Z",
    });
    expect(policyClock(new Date("2026-10-05T10:00:00Z"))).toMatchObject({
      crSeasonId: 137,
      sectionIndex: 0,
      periodIndex: 0,
      seasonStartsAt: "2026-10-05T10:00:00.000Z",
      seasonEndsAt: "2026-11-02T10:00:00.000Z",
    });
  });

  it("numbers seasons one a month from Drop's season 134, across a year", () => {
    expect(policyClock(new Date("2026-07-06T10:00:00Z")).crSeasonId).toBe(134);
    expect(policyClock(new Date("2026-11-13T18:00:00Z")).crSeasonId).toBe(138);
    // 2027-01-04 is January's first Monday.
    expect(policyClock(new Date("2027-01-04T09:00:00Z")).crSeasonId).toBe(139);
    expect(policyClock(new Date("2027-01-04T10:00:00Z")).crSeasonId).toBe(140);
  });

  it("is the clock the boards read", () => {
    const clock = policyClock(new Date("2026-09-08T12:00:00Z"));
    const stored = { ...clock, updatedAt: clock.observedAt };
    const season = seasonForDate(new Date("2026-09-08T12:30:00Z"), stored);
    expect(season).toMatchObject({
      id: 136,
      source: "clash-royale",
      currentWeek: 1,
    });
    expect(seasonForDate(new Date("2026-10-05T09:59:59Z"), stored).id).toBe(
      136,
    );
    expect(seasonForDate(new Date("2026-10-05T10:00:00Z"), stored).id).toBe(
      137,
    );
  });
});
