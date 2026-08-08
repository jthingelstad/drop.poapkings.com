import { BADGE_LIST, type BadgeDefinition } from "@elixir-drop/contracts";
import { isCurrentBoardRun } from "./games.js";
import { cardElixir } from "./scoring.js";
import type { GameMode } from "./types.js";

// The badge engine: pure functions over a counter bag, no I/O. Shaped like
// learning.ts on purpose — the route layer reads the stored item, folds one
// run's facts in here, and writes the result back best-effort.
//
// Two invariants hold everywhere in this file:
//   1. Counters only ever move in their favourable direction.
//   2. Nothing earned is ever revoked. A broken daily streak lowers no badge.
//
// Because awarding is a pure function of the counters, badges can be recomputed
// from run history — which is what makes adding a badge later retroactive.

// Bump when a stored counter must be rebuilt. Version 3 made every mode-skill
// score board-epoch-aware and replaced Unbroken's unreachable 150/200 tail.
// Version 4 moves Coin Flip Killer to Higher/Lower's continuously tightening
// r3 board and its recalibrated ladder, excluding r2's 2s-floor scores.
export const BADGE_COUNTERS_VERSION = 4;

export interface BadgeAux {
  // Distinct modes played, for All Six.
  modes: string[];
  // Distinct card ids read correctly, for Catalog. Bounded by the 120-card
  // catalog, so this array cannot grow without limit.
  cards: number[];
  // Daily Drop / Marathon bookkeeping, in the player's own local day.
  lastDay?: string;
  dayStreak: number;
  dayRuns: number;
}

export interface BadgeCounters {
  version: number;
  // slug -> counter value. A `time` slug is absent until the player records one.
  values: Record<string, number>;
  // `time` slugs only: runs landed at or under each rung, parallel to rungs[].
  runsAtRung: Record<string, number[]>;
  aux: BadgeAux;
  // slug -> ISO timestamp per cleared rung, parallel to rungs[0..rungIndex].
  earned: Record<string, string[]>;
}

// Everything one completed run contributes. The route builds this from the
// already-validated transcript; nothing here is read from raw client input
// except the timezone offset (see localStamp below).
export interface RunFacts {
  mode: GameMode;
  boardEpoch?: string;
  score: number;
  completedAt: string;
  localDay: string;
  localHour: number;
  answered: number;
  correctCards: number[];
  totalGames: number;
  arena: number;
  practiceClean?: boolean;
  photoFinish?: boolean;
  fullCup?: boolean;
  zeroHesitation?: boolean;
  comeback?: boolean;
  coldOpen?: boolean;
}

export interface EarnedRung {
  slug: string;
  rungIndex: number;
  value: number;
  at: string;
}

export function emptyCounters(): BadgeCounters {
  return {
    version: BADGE_COUNTERS_VERSION,
    values: {},
    runsAtRung: {},
    aux: { modes: [], cards: [], dayStreak: 0, dayRuns: 0 },
    earned: {},
  };
}

function cloneCounters(input: BadgeCounters): BadgeCounters {
  return {
    version: BADGE_COUNTERS_VERSION,
    values: { ...input.values },
    runsAtRung: Object.fromEntries(
      Object.entries(input.runsAtRung).map(([slug, counts]) => [
        slug,
        [...counts],
      ]),
    ),
    aux: {
      ...input.aux,
      modes: [...input.aux.modes],
      cards: [...input.aux.cards],
    },
    earned: Object.fromEntries(
      Object.entries(input.earned).map(([slug, stamps]) => [slug, [...stamps]]),
    ),
  };
}

// The player's local calendar day and hour. Night Shift ("between midnight and
// 5am") and Cold Open ("first run of the day") are meaningless in UTC — a
// player in Minneapolis finishing at 11pm is already on the next UTC day. The
// browser therefore sends its offset. It is spoofable, and deliberately so:
// these are hidden vanity badges worth no XP and no leaderboard position, so
// the cost of trusting the client is a player awarding themselves a silhouette.
// Nothing that ranks or progresses reads this.
export function localStamp(
  completedAt: string,
  tzOffsetMinutes: unknown,
): { localDay: string; localHour: number } {
  const raw = typeof tzOffsetMinutes === "number" ? tzOffsetMinutes : 0;
  const offset = Number.isFinite(raw)
    ? Math.max(-14 * 60, Math.min(14 * 60, Math.trunc(raw)))
    : 0;
  // JS getTimezoneOffset() reports minutes BEHIND UTC (UTC-5 => +300), so the
  // local wall clock is UTC minus that offset.
  const local = new Date(new Date(completedAt).getTime() - offset * 60_000);
  return {
    localDay: local.toISOString().slice(0, 10),
    localHour: local.getUTCHours(),
  };
}

function bump(values: Record<string, number>, slug: string, by: number): void {
  if (Number.isFinite(by) && by > 0) values[slug] = (values[slug] ?? 0) + by;
}

function raise(values: Record<string, number>, slug: string, to: number): void {
  if (!Number.isFinite(to)) return;
  if (values[slug] === undefined || to > values[slug]) values[slug] = to;
}

function lower(values: Record<string, number>, slug: string, to: number): void {
  if (!Number.isFinite(to)) return;
  if (values[slug] === undefined || to < values[slug]) values[slug] = to;
}

// Highest cleared rung index, or -1. `time` ladders descend, so they clear on
// value <= rung; everything else clears on value >= rung.
export function rungIndexFor(
  definition: BadgeDefinition,
  value: number | undefined,
): number {
  if (value === undefined) return -1;
  let index = -1;
  for (let i = 0; i < definition.rungs.length; i += 1) {
    const rung = definition.rungs[i];
    if (rung === undefined) break;
    const cleared = definition.kind === "time" ? value <= rung : value >= rung;
    if (!cleared) break;
    index = i;
  }
  return index;
}

// Consecutive-day bookkeeping. Records a BEST, never current state — a broken
// streak resets the running count but never lowers the badge counter.
function foldDay(
  aux: BadgeAux,
  values: Record<string, number>,
  day: string,
): void {
  if (aux.lastDay === day) {
    aux.dayRuns += 1;
  } else {
    const previous = aux.lastDay;
    aux.dayRuns = 1;
    aux.dayStreak =
      previous && dayDifference(previous, day) === 1 ? aux.dayStreak + 1 : 1;
    aux.lastDay = day;
  }
  raise(values, "daily-drop", aux.dayStreak);
  raise(values, "marathon", aux.dayRuns);
}

function dayDifference(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// A `time` ladder counts EVERY run at or under each rung, not just the best —
// so this takes the run's own time, not the stored personal best.
function countRunAtRungs(
  counters: BadgeCounters,
  slug: string,
  runSeconds: number,
): void {
  const definition = BADGE_LIST.find((badge) => badge.slug === slug);
  if (!definition || !Number.isFinite(runSeconds)) return;
  const counts =
    counters.runsAtRung[slug] ??
    new Array<number>(definition.rungs.length).fill(0);
  for (let i = 0; i < definition.rungs.length; i += 1) {
    const rung = definition.rungs[i];
    if (rung !== undefined && runSeconds <= rung)
      counts[i] = (counts[i] ?? 0) + 1;
  }
  counters.runsAtRung[slug] = counts;
}

// Fold one completed run into the counters. Returns a new bag plus every rung
// newly cleared by this run, so the caller can celebrate exactly those.
export function advanceBadges(
  input: BadgeCounters,
  facts: RunFacts,
): { counters: BadgeCounters; newlyEarned: EarnedRung[] } {
  const counters = cloneCounters(input);
  const { values, aux } = counters;
  const currentBoard = isCurrentBoardRun(facts);

  // ── Mode mastery — volume ─────────────────────────────────────────────────
  if (facts.mode === "surge") bump(values, "surge-runner", 1);
  if (facts.mode === "trade") bump(values, "trade-reader", 1);
  if (facts.mode === "survival") bump(values, "last-stand", 1);
  if (facts.mode === "higher-lower") bump(values, "bridge-read", facts.score);
  if (facts.mode === "rain") bump(values, "stormchaser", facts.score);
  if (facts.mode === "practice") bump(values, "reps", facts.answered);
  if (facts.practiceClean) bump(values, "clean-sweep", 1);

  // ── Mode skill — proof. Surge and Trade score in ms; the ladders are in
  // seconds, so convert once here rather than in the rung comparison. ────────
  if (facts.mode === "surge") {
    const seconds = facts.score / 1_000;
    lower(values, "clockbreaker", seconds);
    countRunAtRungs(counters, "clockbreaker", seconds);
  }
  if (facts.mode === "trade" && currentBoard) {
    const seconds = facts.score / 1_000;
    lower(values, "sharp-trade", seconds);
    countRunAtRungs(counters, "sharp-trade", seconds);
  }
  if (facts.mode === "higher-lower" && currentBoard)
    raise(values, "coin-flip-killer", facts.score);
  if (facts.mode === "survival" && currentBoard)
    raise(values, "unbroken", facts.score);
  if (facts.mode === "rain" && currentBoard)
    raise(values, "downpour", facts.score);

  // ── Progression ───────────────────────────────────────────────────────────
  raise(values, "drop-regular", facts.totalGames);
  raise(values, "arena-climber", facts.arena);
  if (!aux.modes.includes(facts.mode)) aux.modes.push(facts.mode);
  raise(values, "all-six", aux.modes.length);

  // ── Card knowledge ────────────────────────────────────────────────────────
  for (const cardId of facts.correctCards) {
    if (!aux.cards.includes(cardId)) aux.cards.push(cardId);
    const elixir = cardElixir(cardId);
    if (elixir !== undefined && elixir >= 6) bump(values, "big-spender", 1);
    // Type comes from the id range: 26 troop, 27 building, 28 spell.
    const family = Math.floor(cardId / 1_000_000);
    if (family === 28) bump(values, "spellcaster", 1);
    if (family === 27) bump(values, "tower-watch", 1);
  }
  raise(values, "catalog", aux.cards.length);

  // ── Habit ─────────────────────────────────────────────────────────────────
  foldDay(aux, values, facts.localDay);

  // ── Hidden. Single-rung moments; once set they never move again. ──────────
  if (facts.localHour < 5) raise(values, "night-shift", 1);
  if (facts.photoFinish) raise(values, "photo-finish", 1);
  if (facts.fullCup) raise(values, "full-cup", 1);
  if (facts.zeroHesitation) raise(values, "zero-hesitation", 1);
  if (facts.comeback) raise(values, "comeback", 1);
  if (facts.coldOpen) raise(values, "cold-open", 1);

  return {
    counters: settle(counters, facts.completedAt),
    newlyEarned: newRungsBetween(input, counters, facts.completedAt),
  };
}

// Podium needs referee-visible season standings, so the result-queue consumer
// calls this once per top-three mode finish when a newer CR season arrives.
// The repository pairs it with a season+mode marker, making redelivery a no-op.
export function recordPodiumFinish(
  input: BadgeCounters,
  at: string,
): { counters: BadgeCounters; newlyEarned: EarnedRung[] } {
  const counters = cloneCounters(input);
  bump(counters.values, "podium", 1);
  return {
    counters: settle(counters, at),
    newlyEarned: newRungsBetween(input, counters, at),
  };
}

// Derive rung positions from the counters and stamp any newly cleared rung.
// Collector resolves last: it depends on every other badge's position, so it
// can only be decided once the rest of this pass has settled.
function settle(counters: BadgeCounters, at: string): BadgeCounters {
  for (const definition of BADGE_LIST) {
    if (definition.slug === "collector") continue;
    stampRungs(counters, definition, at);
  }
  const others = BADGE_LIST.filter((badge) => badge.slug !== "collector");
  if (others.every((badge) => (counters.earned[badge.slug]?.length ?? 0) > 0)) {
    raise(counters.values, "collector", 1);
  }
  const collector = BADGE_LIST.find((badge) => badge.slug === "collector");
  if (collector) stampRungs(counters, collector, at);
  return counters;
}

// Append a timestamp for every rung cleared since the last settle. Never
// shortens the list: that is the "nothing is ever revoked" invariant, and it is
// why a counter that somehow moved backwards cannot take a badge away.
function stampRungs(
  counters: BadgeCounters,
  definition: BadgeDefinition,
  at: string,
): void {
  const index = rungIndexFor(definition, counters.values[definition.slug]);
  const already = counters.earned[definition.slug] ?? [];
  if (index + 1 <= already.length) {
    if (already.length) counters.earned[definition.slug] = already;
    return;
  }
  const stamped = [...already];
  while (stamped.length < index + 1) stamped.push(at);
  counters.earned[definition.slug] = stamped;
}

function newRungsBetween(
  before: BadgeCounters,
  after: BadgeCounters,
  at: string,
): EarnedRung[] {
  const earned: EarnedRung[] = [];
  for (const definition of BADGE_LIST) {
    const had = before.earned[definition.slug]?.length ?? 0;
    const has = after.earned[definition.slug]?.length ?? 0;
    for (let index = had; index < has; index += 1) {
      earned.push({
        slug: definition.slug,
        rungIndex: index,
        value: after.values[definition.slug] ?? 0,
        at,
      });
    }
  }
  return earned;
}

// ── Hidden-badge signals ─────────────────────────────────────────────────────
//
// Read leniently, exactly like learning.ts: the scorer has already validated
// and accepted this transcript, so a shape surprise here must yield "no badge",
// never an exception that fails a recorded run.
//
// Each signal is derived only from the mode whose transcript carries it
// unambiguously — Full Cup from Surge's per-card guess list, Zero Hesitation
// from Survival's per-answer elapsed time, Comeback from Rain's ordered
// clear/miss sequence against three lives. The remaining two (Photo Finish,
// Cold Open) need the previous personal best, so the route supplies them.
function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

const RAIN_LIVES = 3;
const COMEBACK_CLEARS = 20;

export function hiddenSignals(
  mode: GameMode,
  transcript: { answers?: unknown },
): Pick<RunFacts, "fullCup" | "zeroHesitation" | "comeback"> {
  const answers = objectArray(transcript.answers);
  if (!answers.length) return {};

  if (mode === "surge") {
    // Every 6+ cost card in the sprint named right the first time, across a
    // complete 15-card run.
    const sixPlus = answers.filter((answer) => {
      const elixir = cardElixir(Number(answer.cardId));
      return elixir !== undefined && elixir >= 6;
    });
    const fullCup =
      answers.length === 15 &&
      sixPlus.length > 0 &&
      sixPlus.every(
        (answer) =>
          Array.isArray(answer.guesses) && answer.guesses.length === 1,
      );
    return fullCup ? { fullCup: true } : {};
  }

  if (mode === "survival") {
    const zeroHesitation = answers.every(
      (answer) => Number(answer.elapsedMs) < 1_000,
    );
    return zeroHesitation ? { zeroHesitation: true } : {};
  }

  if (mode === "rain") {
    // Walk the run in order. Once two lives are gone the player is on their
    // last, and clearing twenty more from there is the comeback.
    let misses = 0;
    let clearsOnLastLife = 0;
    for (const answer of answers) {
      const elixir = cardElixir(Number(answer.cardId));
      const cleared =
        elixir !== undefined &&
        answer.guess !== null &&
        answer.guess !== undefined &&
        Number(answer.guess) === elixir;
      if (!cleared) {
        misses += 1;
        continue;
      }
      if (misses >= RAIN_LIVES - 1) clearsOnLastLife += 1;
    }
    return clearsOnLastLife >= COMEBACK_CLEARS ? { comeback: true } : {};
  }

  return {};
}

// ── Retroactive backfill ─────────────────────────────────────────────────────
//
// Run history items carry mode, score, seasonId and completedAt, plus the
// validated answer count on newly recorded runs — but NOT the transcript,
// which is why this cannot rebuild every counter. The split:
//
//   Recomputable here — the volume ladders, all five skill ladders, Drop
//   Regular, Arena Climber, All Six, Daily Drop, Marathon, Night Shift, and the
//   four card-knowledge badges (from the CARDSTATS item's per-card correct
//   counts, which the learning path has been writing all along).
//
//   Partially recomputable — Reps includes every run recorded after answerCount
//   was added. Older Practice history stores only accuracy, so legacy sessions
//   cannot be inferred. Clean Sweep, Podium, and the transcript-derived hidden
//   badges remain forward-only.
//
// Two approximations, both deliberate: history has no timezone, so day
// boundaries and Night Shift's hour are resolved in UTC here and in local time
// going forward; and rungs stamped by a backfill all carry the same timestamp,
// because the moment a rung was really cleared is not recoverable.
export interface HistoricalRun {
  runId?: string;
  mode: GameMode;
  score: number;
  completedAt: string;
  answerCount?: number;
  boardEpoch?: string;
}

export interface BackfillCardStat {
  correct: number;
}

export function recomputeCounters(
  runs: HistoricalRun[],
  cardStats: Record<string, BackfillCardStat>,
  profile: { totalGames: number; xp: number },
  arenaFor: (xp: number) => number,
  at: string,
): BadgeCounters {
  const counters = emptyCounters();
  const { values, aux } = counters;
  const ordered = [...runs].sort(
    (left, right) =>
      Date.parse(left.completedAt) - Date.parse(right.completedAt),
  );

  for (const run of ordered) {
    const currentBoard = isCurrentBoardRun(run);
    if (run.mode === "surge") {
      bump(values, "surge-runner", 1);
      const seconds = run.score / 1_000;
      lower(values, "clockbreaker", seconds);
      countRunAtRungs(counters, "clockbreaker", seconds);
    }
    if (run.mode === "trade") {
      bump(values, "trade-reader", 1);
      if (currentBoard) {
        const seconds = run.score / 1_000;
        lower(values, "sharp-trade", seconds);
        countRunAtRungs(counters, "sharp-trade", seconds);
      }
    }
    if (run.mode === "survival") {
      bump(values, "last-stand", 1);
      if (currentBoard) raise(values, "unbroken", run.score);
    }
    if (run.mode === "higher-lower") {
      bump(values, "bridge-read", run.score);
      if (currentBoard) raise(values, "coin-flip-killer", run.score);
    }
    if (run.mode === "rain") {
      bump(values, "stormchaser", run.score);
      if (currentBoard) raise(values, "downpour", run.score);
    }
    if (run.mode === "practice") bump(values, "reps", run.answerCount ?? 0);
    if (!aux.modes.includes(run.mode)) aux.modes.push(run.mode);
    const stamp = new Date(run.completedAt);
    if (stamp.getUTCHours() < 5) raise(values, "night-shift", 1);
    foldDay(aux, values, run.completedAt.slice(0, 10));
  }

  raise(values, "all-six", aux.modes.length);
  raise(values, "drop-regular", profile.totalGames);
  raise(values, "arena-climber", arenaFor(profile.xp));

  for (const [key, stat] of Object.entries(cardStats)) {
    if (!stat || stat.correct <= 0) continue;
    const cardId = Number(key);
    const elixir = cardElixir(cardId);
    if (elixir === undefined) continue;
    if (!aux.cards.includes(cardId)) aux.cards.push(cardId);
    if (elixir >= 6) bump(values, "big-spender", stat.correct);
    const family = Math.floor(cardId / 1_000_000);
    if (family === 28) bump(values, "spellcaster", stat.correct);
    if (family === 27) bump(values, "tower-watch", stat.correct);
  }
  raise(values, "catalog", aux.cards.length);

  return settle(counters, at);
}

const VERSIONED_SKILL_BADGES = [
  "sharp-trade",
  "coin-flip-killer",
  "unbroken",
  "downpour",
] as const;

// Older versions can contain incomparable skill scores from retired boards.
// Rebuild only those four badges from current-board history: every other stored
// counter includes forward-only facts (Podium, Clean Sweep, hidden badges,
// local-day context) that history cannot reproduce. Invalid retired-board
// rungs are the one exception to the no-revocation rule — they never met the
// current badge requirement.
export function migrateBadgeCounters(
  input: BadgeCounters,
  runs: HistoricalRun[],
  at: string,
): BadgeCounters {
  if (input.version !== 1 && input.version !== 2 && input.version !== 3)
    throw new Error(`Unsupported badge counter version ${input.version}`);
  const counters = cloneCounters(input);
  for (const slug of VERSIONED_SKILL_BADGES) {
    delete counters.values[slug];
    delete counters.runsAtRung[slug];
    delete counters.earned[slug];
  }

  for (const run of runs) {
    if (!isCurrentBoardRun(run)) continue;
    if (run.mode === "trade") {
      const seconds = run.score / 1_000;
      lower(counters.values, "sharp-trade", seconds);
      countRunAtRungs(counters, "sharp-trade", seconds);
    }
    if (run.mode === "higher-lower")
      raise(counters.values, "coin-flip-killer", run.score);
    if (run.mode === "survival") raise(counters.values, "unbroken", run.score);
    if (run.mode === "rain") raise(counters.values, "downpour", run.score);
  }
  return settle(counters, at);
}

export function badgeStates(counters: BadgeCounters) {
  return BADGE_LIST.map((definition) => {
    const value = counters.values[definition.slug];
    const runsAtRung = counters.runsAtRung[definition.slug];
    return {
      slug: definition.slug,
      value: value ?? 0,
      rungIndex: rungIndexFor(definition, value),
      earnedAt: counters.earned[definition.slug] ?? [],
      ...(definition.kind === "time" && runsAtRung ? { runsAtRung } : {}),
    };
  });
}
