import type { XpAward, XpAwardSource } from "@elixir-drop/contracts";
import type { RunRecord, XpAwardMarker } from "./types.js";

export type XpTimelineSource = XpAwardSource | "legacy-run";

export interface XpTimelineSourceTotal {
  source: XpTimelineSource;
  xp: number;
  events: number;
}

export interface XpTimelineDay {
  date: string;
  xp: number;
  events: number;
  sources: XpTimelineSourceTotal[];
}

export interface XpTimeline {
  totalXp: number;
  attributedXp: number;
  openingBalance: number;
  timeZone: "UTC";
  days: XpTimelineDay[];
}

const SOURCE_ORDER: readonly XpTimelineSource[] = [
  "game",
  "practice",
  "legacy-run",
  "personal-best",
  "daily-featured",
  "badge",
  "season-placement",
  "season-circuit",
];

interface TimelineEvent {
  at: string;
  source: XpTimelineSource;
  amount: number;
}

function addAward(
  events: TimelineEvent[],
  at: string,
  award: Pick<XpAward, "source" | "amount">,
): void {
  if (Number.isInteger(award.amount) && award.amount > 0)
    events.push({ at, source: award.source, amount: award.amount });
}

// Run history carries all stacked awards, while every non-base award also has
// an immutable XP marker. Count only game/practice base awards from modern run
// rows, then count every marker once. Older rows without a source breakdown
// retain their stored XP as one legacy run event.
export function buildXpTimeline(
  totalXp: number,
  runs: Array<Pick<RunRecord, "completedAt" | "xp" | "xpAwards">>,
  markers: XpAwardMarker[],
): XpTimeline {
  const events: TimelineEvent[] = [];
  for (const run of runs) {
    const awards = run.xpAwards ?? [];
    if (awards.length) {
      for (const award of awards) {
        if (award.source === "game" || award.source === "practice")
          addAward(events, run.completedAt, award);
      }
    } else if (Number.isInteger(run.xp) && (run.xp ?? 0) > 0) {
      events.push({
        at: run.completedAt,
        source: "legacy-run",
        amount: run.xp!,
      });
    }
  }
  for (const marker of markers)
    addAward(events, marker.awardedAt, marker.award);

  const dayMap = new Map<
    string,
    {
      xp: number;
      events: number;
      sources: Map<XpTimelineSource, XpTimelineSourceTotal>;
    }
  >();
  for (const event of events) {
    const date = event.at.slice(0, 10);
    const day = dayMap.get(date) ?? {
      xp: 0,
      events: 0,
      sources: new Map<XpTimelineSource, XpTimelineSourceTotal>(),
    };
    day.xp += event.amount;
    day.events += 1;
    const source = day.sources.get(event.source) ?? {
      source: event.source,
      xp: 0,
      events: 0,
    };
    source.xp += event.amount;
    source.events += 1;
    day.sources.set(event.source, source);
    dayMap.set(date, day);
  }

  const days = [...dayMap.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, day]) => ({
      date,
      xp: day.xp,
      events: day.events,
      sources: SOURCE_ORDER.flatMap((source) => {
        const total = day.sources.get(source);
        return total ? [total] : [];
      }),
    }));
  const attributedXp = days.reduce((total, day) => total + day.xp, 0);
  if (attributedXp > totalXp)
    throw new Error("Attributed XP exceeds the player's lifetime total");

  return {
    totalXp,
    attributedXp,
    openingBalance: totalXp - attributedXp,
    timeZone: "UTC",
    days,
  };
}
