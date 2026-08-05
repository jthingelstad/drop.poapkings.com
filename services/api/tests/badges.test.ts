import { arenaForXp, BADGE_LIST } from "@elixir-drop/contracts";
import { describe, expect, it } from "vitest";
import {
  advanceBadges,
  badgeStates,
  emptyCounters,
  hiddenSignals,
  localStamp,
  recomputeCounters,
  recordPodiumFinish,
  rungIndexFor,
  type BadgeCounters,
  type RunFacts,
} from "../src/badges.js";

function facts(overrides: Partial<RunFacts> = {}): RunFacts {
  return {
    mode: "surge",
    score: 20_000,
    completedAt: "2026-08-02T15:00:00.000Z",
    localDay: "2026-08-02",
    localHour: 10,
    answered: 15,
    correctCards: [],
    totalGames: 1,
    arena: 1,
    ...overrides,
  };
}

function stateOf(counters: BadgeCounters, slug: string) {
  const state = badgeStates(counters).find((badge) => badge.slug === slug);
  if (!state) throw new Error(`No badge state for ${slug}`);
  return state;
}

function play(runs: Array<Partial<RunFacts>>): BadgeCounters {
  let counters = emptyCounters();
  for (const run of runs)
    counters = advanceBadges(counters, facts(run)).counters;
  return counters;
}

describe("the badge table", () => {
  it("holds 29 badges, 22 visible and 7 hidden", () => {
    expect(BADGE_LIST).toHaveLength(29);
    expect(BADGE_LIST.filter((badge) => badge.hidden)).toHaveLength(7);
  });

  it("orders count/best rungs upward and time rungs downward", () => {
    for (const badge of BADGE_LIST) {
      const rungs = [...badge.rungs];
      const sorted =
        badge.kind === "time"
          ? [...rungs].sort((a, b) => b - a)
          : [...rungs].sort((a, b) => a - b);
      expect(rungs, `${badge.slug} rungs must be monotonic`).toEqual(sorted);
      expect(new Set(rungs).size, `${badge.slug} has duplicate rungs`).toBe(
        rungs.length,
      );
    }
  });
});

describe("rung derivation", () => {
  it("clears a count ladder upward and a time ladder downward", () => {
    const surgeRunner = BADGE_LIST.find((b) => b.slug === "surge-runner")!;
    expect(rungIndexFor(surgeRunner, undefined)).toBe(-1);
    expect(rungIndexFor(surgeRunner, 9)).toBe(-1);
    expect(rungIndexFor(surgeRunner, 10)).toBe(0);
    expect(rungIndexFor(surgeRunner, 650)).toBe(surgeRunner.rungs.length - 1);

    // Clockbreaker: 60·50·42·35·30·26·22·19·17·15·13·12, lower is better.
    const clockbreaker = BADGE_LIST.find((b) => b.slug === "clockbreaker")!;
    expect(rungIndexFor(clockbreaker, 61)).toBe(-1);
    expect(rungIndexFor(clockbreaker, 60)).toBe(0);
    expect(rungIndexFor(clockbreaker, 35)).toBe(3);
    expect(rungIndexFor(clockbreaker, 12)).toBe(11);
  });

  it("puts the live Surge record at rung 11 of 12 — still one to chase", () => {
    const clockbreaker = BADGE_LIST.find((b) => b.slug === "clockbreaker")!;
    // 12.861s was the all-time best when these rungs were calibrated.
    expect(rungIndexFor(clockbreaker, 12.861)).toBe(10);
    expect(clockbreaker.rungs.length - 1).toBe(11);
  });

  it("gives a typical Trade learner an early rung and keeps the live best below the ceiling", () => {
    const sharpTrade = BADGE_LIST.find((b) => b.slug === "sharp-trade")!;
    // ~97s is the old 8-exchange median scaled to the current 10 reads.
    expect(rungIndexFor(sharpTrade, 97)).toBe(4);
    // The only current-board best (67.1s) clears through 72s, with six harder
    // milestones still visible down to the 40s ceiling.
    expect(rungIndexFor(sharpTrade, 67.1)).toBe(7);
    expect(sharpTrade.rungs.at(-1)).toBe(40);
  });
});

describe("advanceBadges", () => {
  it("has an executable writer for every catalog badge", () => {
    let counters = emptyCounters();
    const runs: Array<Partial<RunFacts>> = [
      {
        mode: "surge",
        score: 11_000,
        correctCards: [26000009, 27000000, 28000000],
        totalGames: 10_000,
        arena: 28,
        localHour: 2,
        photoFinish: true,
        fullCup: true,
        coldOpen: true,
      },
      { mode: "trade", score: 39_000 },
      { mode: "higher-lower", score: 10_000 },
      { mode: "survival", score: 10_000, zeroHesitation: true },
      { mode: "rain", score: 10_000, comeback: true },
      {
        mode: "practice",
        answered: 21_000,
        practiceClean: true,
      },
    ];
    for (const run of runs)
      counters = advanceBadges(counters, facts(run)).counters;
    counters = recordPodiumFinish(
      counters,
      "2026-08-03T10:12:48.768Z",
    ).counters;

    const missingWriters = BADGE_LIST.filter(
      (badge) =>
        badge.slug !== "collector" && counters.values[badge.slug] === undefined,
    ).map((badge) => badge.slug);
    expect(missingWriters).toEqual([]);

    // Collector is a derived writer: once every other badge has rung one, a
    // normal settle pass activates it too.
    const forged = emptyCounters();
    for (const badge of BADGE_LIST) {
      if (badge.slug !== "collector")
        forged.earned[badge.slug] = ["2026-08-03T10:12:48.768Z"];
    }
    expect(advanceBadges(forged, facts()).counters.values.collector).toBe(1);
  });

  it("counts a Surge run toward volume and speed at once", () => {
    const counters = play([{ mode: "surge", score: 19_000 }]);
    expect(stateOf(counters, "surge-runner").value).toBe(1);
    expect(stateOf(counters, "clockbreaker").value).toBe(19);
  });

  it("accumulates Reps across Practice sessions", () => {
    const counters = play([
      { mode: "practice", answered: 40 },
      { mode: "practice", answered: 75 },
    ]);
    const reps = stateOf(counters, "reps");
    expect(reps.value).toBe(115);
    expect(reps.rungIndex).toBe(0);
  });

  it("keeps the best time, not the latest", () => {
    const counters = play([
      { mode: "surge", score: 19_000 },
      { mode: "surge", score: 44_000 },
    ]);
    expect(stateOf(counters, "clockbreaker").value).toBe(19);
  });

  it("counts every run at or under each time rung, not just the best", () => {
    const counters = play([
      { mode: "surge", score: 34_000 },
      { mode: "surge", score: 34_500 },
      { mode: "surge", score: 19_000 },
    ]);
    const runs = stateOf(counters, "clockbreaker").runsAtRung ?? [];
    // rungs: 60 50 42 35 30 26 22 19 17 15 13 12
    expect(runs[0]).toBe(3); // all three are under 60s
    expect(runs[3]).toBe(3); // all three are under 35s
    expect(runs[4]).toBe(1); // only the 19s run is under 30s
    expect(runs[7]).toBe(1); // and it exactly meets the 19s rung
    expect(runs[8]).toBe(0); // nothing under 17s
  });

  it("reports each newly cleared rung exactly once", () => {
    let counters = emptyCounters();
    const first = advanceBadges(counters, facts({ mode: "rain", score: 30 }));
    counters = first.counters;
    // Rain 30 clears Downpour rung one (25) and Stormchaser has none yet (100).
    expect(first.newlyEarned.map((rung) => rung.slug)).toContain("downpour");

    const again = advanceBadges(counters, facts({ mode: "rain", score: 30 }));
    // The same rung must not be celebrated twice.
    expect(again.newlyEarned.map((rung) => rung.slug)).not.toContain(
      "downpour",
    );
  });

  it("never revokes an earned rung when a counter cannot improve", () => {
    const counters = play([
      { mode: "survival", score: 60 },
      { mode: "survival", score: 1 },
    ]);
    const unbroken = stateOf(counters, "unbroken");
    expect(unbroken.value).toBe(60);
    expect(unbroken.rungIndex).toBe(3); // 15·25·40·60 -> index 3
    expect(unbroken.earnedAt).toHaveLength(4);
  });

  it("records a daily streak as a best, so breaking it takes nothing away", () => {
    const counters = play([
      { localDay: "2026-08-01" },
      { localDay: "2026-08-02" },
      { localDay: "2026-08-03" },
      // A four-day gap breaks the streak.
      { localDay: "2026-08-07" },
    ]);
    expect(stateOf(counters, "daily-drop").value).toBe(3);
  });

  it("counts games per day for Marathon", () => {
    const counters = play([
      { localDay: "2026-08-01" },
      { localDay: "2026-08-01" },
      { localDay: "2026-08-01" },
      { localDay: "2026-08-01" },
      { localDay: "2026-08-01" },
      { localDay: "2026-08-02" },
    ]);
    expect(stateOf(counters, "marathon").value).toBe(5);
  });

  it("sorts correct cards into the card-knowledge ladders by id family and cost", () => {
    // 28000000 is a spell, 27000000 a building, 26000000 a 3-cost troop.
    const counters = play([
      { mode: "practice", correctCards: [28000000, 27000000, 26000000] },
    ]);
    expect(stateOf(counters, "spellcaster").value).toBe(1);
    expect(stateOf(counters, "tower-watch").value).toBe(1);
    expect(stateOf(counters, "catalog").value).toBe(3);
  });

  it("counts a unique card once for Catalog but every read for the cost ladders", () => {
    const counters = play([
      { mode: "practice", correctCards: [28000000] },
      { mode: "practice", correctCards: [28000000] },
    ]);
    expect(stateOf(counters, "catalog").value).toBe(1);
    expect(stateOf(counters, "spellcaster").value).toBe(2);
  });

  it("fires Night Shift only between midnight and 5am local", () => {
    expect(stateOf(play([{ localHour: 2 }]), "night-shift").rungIndex).toBe(0);
    expect(stateOf(play([{ localHour: 5 }]), "night-shift").rungIndex).toBe(-1);
    expect(stateOf(play([{ localHour: 13 }]), "night-shift").rungIndex).toBe(
      -1,
    );
  });

  it("awards Collector only once every other badge has its first rung", () => {
    const counters = play([{ mode: "surge", score: 19_000 }]);
    expect(stateOf(counters, "collector").rungIndex).toBe(-1);

    // Forge a bag where all 28 others are on rung one.
    const forged = emptyCounters();
    for (const badge of BADGE_LIST) {
      if (badge.slug === "collector") continue;
      forged.earned[badge.slug] = ["2026-08-02T00:00:00.000Z"];
    }
    const settled = advanceBadges(forged, facts()).counters;
    expect(stateOf(settled, "collector").rungIndex).toBe(0);
  });
});

describe("localStamp", () => {
  it("resolves the player's own day, not the UTC day", () => {
    // 02:00 UTC on the 3rd is still 21:00 on the 2nd in UTC-5 (offset +300).
    const stamp = localStamp("2026-08-03T02:00:00.000Z", 300);
    expect(stamp.localDay).toBe("2026-08-02");
    expect(stamp.localHour).toBe(21);
  });

  it("falls back to UTC for a missing or absurd offset", () => {
    expect(localStamp("2026-08-02T15:00:00.000Z", undefined).localHour).toBe(
      15,
    );
    expect(localStamp("2026-08-02T15:00:00.000Z", 99_999).localHour).toBe(1);
  });
});

describe("hidden badge signals", () => {
  it("derives Full Cup from a complete Surge transcript with one guess per expensive card", () => {
    expect(
      hiddenSignals("surge", {
        answers: Array.from({ length: 15 }, () => ({
          cardId: 26000009,
          guesses: [8],
        })),
      }),
    ).toEqual({ fullCup: true });
  });

  it("derives Zero Hesitation only when every Survival answer is under one second", () => {
    expect(
      hiddenSignals("survival", {
        answers: [{ elapsedMs: 999 }, { elapsedMs: 500 }],
      }),
    ).toEqual({ zeroHesitation: true });
    expect(
      hiddenSignals("survival", {
        answers: [{ elapsedMs: 1_000 }],
      }),
    ).toEqual({});
  });

  it("derives Comeback after twenty Rain clears on the last life", () => {
    expect(
      hiddenSignals("rain", {
        answers: [
          { cardId: 26000000, guess: null },
          { cardId: 26000000, guess: null },
          ...Array.from({ length: 20 }, () => ({
            cardId: 26000000,
            guess: 3,
          })),
        ],
      }),
    ).toEqual({ comeback: true });
  });
});

describe("recomputeCounters", () => {
  const history = [
    {
      mode: "surge" as const,
      score: 19_000,
      completedAt: "2026-07-01T12:00:00.000Z",
    },
    {
      mode: "surge" as const,
      score: 26_000,
      completedAt: "2026-07-02T12:00:00.000Z",
    },
    {
      mode: "rain" as const,
      score: 40,
      completedAt: "2026-07-03T12:00:00.000Z",
    },
  ];

  it("rebuilds volume, speed and streak counters from run history alone", () => {
    const counters = recomputeCounters(
      history,
      {},
      { totalGames: 3, xp: 500 },
      arenaForXp,
      "2026-08-02T00:00:00.000Z",
    );
    expect(stateOf(counters, "surge-runner").value).toBe(2);
    expect(stateOf(counters, "clockbreaker").value).toBe(19);
    expect(stateOf(counters, "downpour").value).toBe(40);
    expect(stateOf(counters, "all-six").value).toBe(2);
    expect(stateOf(counters, "daily-drop").value).toBe(3);
    // 500 XP lands in arena 5 (thresholds 0/40/100/200/350/550).
    expect(stateOf(counters, "arena-climber").value).toBe(5);
  });

  it("rebuilds card knowledge from the stored learning stats", () => {
    const counters = recomputeCounters(
      history,
      { "28000000": { correct: 12 }, "27000000": { correct: 4 } },
      { totalGames: 3, xp: 0 },
      arenaForXp,
      "2026-08-02T00:00:00.000Z",
    );
    expect(stateOf(counters, "spellcaster").value).toBe(12);
    expect(stateOf(counters, "tower-watch").value).toBe(4);
    expect(stateOf(counters, "catalog").value).toBe(2);
  });

  it("rebuilds Reps from Practice history with validated answer counts", () => {
    const counters = recomputeCounters(
      [
        {
          mode: "practice",
          score: 90,
          completedAt: "2026-08-03T12:00:00.000Z",
          answerCount: 40,
        },
        {
          mode: "practice",
          score: 80,
          completedAt: "2026-08-04T12:00:00.000Z",
          answerCount: 75,
        },
        // Legacy rows have no answer count and cannot safely be guessed from
        // their accuracy score.
        {
          mode: "practice",
          score: 100,
          completedAt: "2026-08-05T12:00:00.000Z",
        },
      ],
      {},
      { totalGames: 3, xp: 0 },
      arenaForXp,
      "2026-08-06T00:00:00.000Z",
    );
    expect(stateOf(counters, "reps").value).toBe(115);
  });

  it("leaves the transcript-derived badges at zero — they are forward-only", () => {
    const counters = recomputeCounters(
      history,
      {},
      { totalGames: 3, xp: 0 },
      arenaForXp,
      "2026-08-02T00:00:00.000Z",
    );
    for (const slug of [
      "reps",
      "clean-sweep",
      "podium",
      "photo-finish",
      "full-cup",
      "zero-hesitation",
      "comeback",
      "cold-open",
    ]) {
      expect(
        stateOf(counters, slug).rungIndex,
        `${slug} must not backfill`,
      ).toBe(-1);
    }
  });

  it("is order-independent: shuffled history yields identical counters", () => {
    const forward = recomputeCounters(
      history,
      {},
      { totalGames: 3, xp: 500 },
      arenaForXp,
      "2026-08-02T00:00:00.000Z",
    );
    const reversed = recomputeCounters(
      [...history].reverse(),
      {},
      { totalGames: 3, xp: 500 },
      arenaForXp,
      "2026-08-02T00:00:00.000Z",
    );
    expect(reversed.values).toEqual(forward.values);
  });
});
