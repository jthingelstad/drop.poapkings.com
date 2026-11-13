/** The Clash Royale season clock, computed by Drop itself.
 *
 * Drop used to read this from Elixir (`GET /api/v1/game/clock`), and Elixir
 * computed it from the calendar, never from a clan: a season runs from the
 * first Monday of a month to the first Monday of the next, rolling at
 * 10:00:00 UTC; days roll at the same hour; each week is three training
 * days then four war days, and the season's last week is Colosseum
 * (cr-agent-api-docs, clans.md, "A season runs first Monday of the month").
 * The same calendar math needs no network, so Drop keeps no dependency on
 * Elixir for it (Jamie, 2026-11-13: Drop talks to Elixir only to sign
 * people in).
 *
 * Season numbers are the river-race `seasonId`, one per month: Drop's first
 * board, season 134, opened on 2026-07-06 (`FIRST_DROP_SEASON_ID`). */
import { FIRST_DROP_SEASON_ID, type CrWarClock } from "@elixir-drop/contracts";

const RESET_HOUR_UTC = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const TRAINING_DAYS = 3;
const FIRST_DROP_SEASON_MONTH = 2026 * 12 + 6;

/** The first Monday of a month at the 10:00 UTC reset. */
export function firstMondayAtReset(year: number, monthIndex: number): Date {
  const first = new Date(Date.UTC(year, monthIndex, 1, RESET_HOUR_UTC));
  const daysUntilMonday = (8 - first.getUTCDay()) % 7;
  first.setUTCDate(first.getUTCDate() + daysUntilMonday);
  return first;
}

/** The season number of the season that starts in a date's month. */
export function calendarSeasonNumber(date: Date): number {
  return (
    FIRST_DROP_SEASON_ID +
    (date.getUTCFullYear() * 12 + date.getUTCMonth() - FIRST_DROP_SEASON_MONTH)
  );
}

/** The season start at or before an instant. */
export function seasonStartAtOrBefore(input: Date): Date {
  const thisMonth = firstMondayAtReset(
    input.getUTCFullYear(),
    input.getUTCMonth(),
  );
  return input.getTime() >= thisMonth.getTime()
    ? thisMonth
    : firstMondayAtReset(input.getUTCFullYear(), input.getUTCMonth() - 1);
}

/** The policy clock at an instant: what Elixir's game clock answered, from
 * the same calendar. `observedAt` is the instant it was computed for. */
export function policyClock(now: Date = new Date()): CrWarClock {
  const start = seasonStartAtOrBefore(now);
  const end = firstMondayAtReset(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
  );
  const periodIndex = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const sectionIndex = Math.floor(periodIndex / 7);
  const dayStart = start.getTime() + periodIndex * DAY_MS;
  const finalWeek = Math.round((end.getTime() - start.getTime()) / WEEK_MS) - 1;
  const training = periodIndex % 7 < TRAINING_DAYS;
  return {
    crSeasonId: calendarSeasonNumber(start),
    sectionIndex,
    periodIndex,
    periodType: training
      ? "training"
      : sectionIndex === finalWeek
        ? "colosseum"
        : "warDay",
    seasonStartsAt: start.toISOString(),
    seasonEndsAt: end.toISOString(),
    dayStartsAt: new Date(dayStart).toISOString(),
    dayEndsAt: new Date(dayStart + DAY_MS).toISOString(),
    observedAt: now.toISOString(),
    clockSource: "policy",
  };
}
