import type { Season } from "@elixir-drop/contracts";
import type { StoredCrWarClock } from "./types.js";

const RESET_HOUR_UTC = 10;
const CLOCK_FRESH_MS = 2 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
// Clan Wars seasons run four or five weeks; past five weeks a stored clock
// cannot describe the current season any more.
const MAX_SEASON_MS = 5 * WEEK_MS;

function firstMondayAtReset(year: number, monthIndex: number): Date {
  const first = new Date(Date.UTC(year, monthIndex, 1, RESET_HOUR_UTC));
  const daysUntilMonday = (8 - first.getUTCDay()) % 7;
  first.setUTCDate(first.getUTCDate() + daysUntilMonday);
  return first;
}

function seasonStartingAt(date: Date): Season {
  const next = firstMondayAtReset(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
  );
  const id = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    id,
    startsAt: date.toISOString(),
    endsAt: next.toISOString(),
    durationWeeks: Math.round((next.getTime() - date.getTime()) / (7 * DAY_MS)),
  };
}

function daysRemainingInWeek(
  input: Date,
  startsAt: Date,
  currentWeek: number,
): number {
  const weekEndsAt = startsAt.getTime() + currentWeek * 7 * DAY_MS;
  return Math.max(0, Math.ceil((weekEndsAt - input.getTime()) / DAY_MS));
}

// A five-week season outlives the calendar guess of "first Monday of the next
// month"; once the clock has observed a fifth week, extend the end date.
function withObservedWeeks(season: Season, currentWeek: number): Season {
  const startsAt = new Date(season.startsAt);
  const observedEnd = startsAt.getTime() + currentWeek * WEEK_MS;
  if (observedEnd <= new Date(season.endsAt).getTime()) return season;
  return {
    ...season,
    endsAt: new Date(observedEnd).toISOString(),
    durationWeeks: currentWeek,
  };
}

function seasonFromWarClock(
  input: Date,
  clock: StoredCrWarClock,
): Season | undefined {
  const observedAt = new Date(clock.observedAt);
  const startsAt = new Date(clock.seasonStartsAt);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    !Number.isFinite(startsAt.getTime()) ||
    input.getTime() < startsAt.getTime() ||
    input.getTime() - observedAt.getTime() > CLOCK_FRESH_MS ||
    observedAt.getTime() - input.getTime() > 5 * 60 * 1_000
  )
    return undefined;

  const currentWeek = clock.sectionIndex + 1;
  const season = withObservedWeeks(seasonStartingAt(startsAt), currentWeek);
  return {
    ...season,
    id: clock.leaderboardSeasonId,
    source: "clash-royale",
    crSeasonId: clock.crSeasonId,
    currentWeek,
    daysRemainingInWeek: daysRemainingInWeek(input, startsAt, currentWeek),
    periodType: clock.periodType,
    clockUpdatedAt: clock.observedAt,
  };
}

// A stale clock still names the right leaderboard season while the date sits
// inside the season it observed. Without this, a >2h bridge outage mid-season
// flipped completions to a calendar-derived id, splitting the leaderboard.
function seasonFromStaleClock(
  input: Date,
  clock: StoredCrWarClock,
): Season | undefined {
  const startsAt = new Date(clock.seasonStartsAt);
  if (!Number.isFinite(startsAt.getTime())) return undefined;
  const elapsed = input.getTime() - startsAt.getTime();
  if (elapsed < 0 || elapsed >= MAX_SEASON_MS) return undefined;
  const currentWeek = Math.min(5, Math.floor(elapsed / WEEK_MS) + 1);
  const season = withObservedWeeks(
    seasonStartingAt(startsAt),
    Math.max(currentWeek, clock.sectionIndex + 1),
  );
  return {
    ...season,
    id: clock.leaderboardSeasonId,
    source: "calendar-fallback",
    crSeasonId: clock.crSeasonId,
    currentWeek,
    daysRemainingInWeek: daysRemainingInWeek(input, startsAt, currentWeek),
    clockUpdatedAt: clock.observedAt,
  };
}

export function seasonForDate(
  input: Date = new Date(),
  clock?: StoredCrWarClock,
): Season {
  const live = clock ? seasonFromWarClock(input, clock) : undefined;
  if (live) return live;
  const carried = clock ? seasonFromStaleClock(input, clock) : undefined;
  if (carried) return carried;

  const thisMonth = firstMondayAtReset(
    input.getUTCFullYear(),
    input.getUTCMonth(),
  );
  const season = seasonStartingAt(
    input.getTime() >= thisMonth.getTime()
      ? thisMonth
      : firstMondayAtReset(input.getUTCFullYear(), input.getUTCMonth() - 1),
  );
  const startsAt = new Date(season.startsAt);
  const currentWeek =
    Math.floor((input.getTime() - startsAt.getTime()) / (7 * DAY_MS)) + 1;
  return {
    ...season,
    source: "calendar-fallback",
    currentWeek,
    daysRemainingInWeek: daysRemainingInWeek(input, startsAt, currentWeek),
  };
}

export function upcomingSeasons(
  input: Date = new Date(),
  count = 3,
  clock?: StoredCrWarClock,
): Season[] {
  if (count <= 0) return [];
  const current = seasonForDate(input, clock);
  const start = new Date(current.startsAt);
  const seasons: Season[] = [current];
  for (let offset = 1; offset < count; offset += 1) {
    seasons.push(
      seasonStartingAt(
        firstMondayAtReset(
          start.getUTCFullYear(),
          start.getUTCMonth() + offset,
        ),
      ),
    );
  }
  return seasons;
}
