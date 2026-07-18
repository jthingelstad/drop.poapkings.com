export interface Season {
  id: string;
  startsAt: string;
  endsAt: string;
  durationWeeks: number;
}

const RESET_HOUR_UTC = 10;

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
    durationWeeks: Math.round(
      (next.getTime() - date.getTime()) / (7 * 24 * 60 * 60 * 1_000),
    ),
  };
}

export function seasonForDate(input: Date = new Date()): Season {
  const thisMonth = firstMondayAtReset(
    input.getUTCFullYear(),
    input.getUTCMonth(),
  );
  if (input.getTime() >= thisMonth.getTime())
    return seasonStartingAt(thisMonth);
  return seasonStartingAt(
    firstMondayAtReset(input.getUTCFullYear(), input.getUTCMonth() - 1),
  );
}

export function upcomingSeasons(input: Date = new Date(), count = 3): Season[] {
  const current = seasonForDate(input);
  const start = new Date(current.startsAt);
  const seasons: Season[] = [];
  for (let offset = 0; offset < count; offset += 1) {
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
