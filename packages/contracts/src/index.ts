export const GAME_MODES = [
  "surge",
  "practice",
  "higher-lower",
  "trade",
  "survival",
  "rain",
] as const;

const EMAIL_LOCAL_PATTERN = /^[a-z0-9.!#$%&'+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const EMAIL_TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;

export function emailValidationMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim())
    return "Enter your email address.";
  const email = value.trim();
  if (email.includes("*"))
    return "Enter your complete email address, not a masked address.";
  if (email.length > 254) return "Enter a valid email address.";

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@"))
    return "Enter a valid email address.";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !EMAIL_LOCAL_PATTERN.test(local)
  )
    return "Enter a valid email address.";

  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label || label.length > 63 || !EMAIL_DOMAIN_LABEL_PATTERN.test(label),
    ) ||
    !EMAIL_TLD_PATTERN.test(labels[labels.length - 1] || "")
  )
    return "Enter a valid email address.";
  return undefined;
}

export type GameMode = (typeof GAME_MODES)[number];

// Player XP v2 is progression with several explicit sources: completing games,
// improving, showing up for the featured game, earning badge rungs, and placing
// at season close. Keep every amount and boundary here so the API, browser, and
// public /xp/ reference cannot drift into three different rulebooks.
export const XP_RULES_VERSION = 2;

export type XpAwardSource =
  | "game"
  | "practice"
  | "personal-best"
  | "daily-featured"
  | "badge"
  | "season-placement"
  | "season-circuit";

export interface XpAward {
  source: XpAwardSource;
  label: string;
  amount: number;
}

export interface XpBand {
  min: number;
  max?: number;
  xp: number;
}

export const SURGE_COMPLETION_XP = 15;
export const TRADE_COMPLETION_XP = 100;
export const PRACTICE_CARDS_PER_XP = 2;
export const PERSONAL_BEST_XP = 10;
export const PERSONAL_BEST_DAILY_LIMIT = 3;
export const DAILY_FEATURED_XP = 5;
export const SEASON_CIRCUIT_XP = 100;
// Season 135 is the first season that can pay placement/Circuit XP. Earlier
// Podium repairs remain badge-only so activation never backfills old boards.
export const XP_FIRST_SEASON_ID = "2026-08";

export const PERFORMANCE_XP_BANDS = {
  "higher-lower": [
    { min: 0, max: 4, xp: -1 },
    { min: 5, max: 9, xp: 10 },
    { min: 10, max: 19, xp: 20 },
    { min: 20, max: 29, xp: 40 },
    { min: 30, max: 39, xp: 60 },
    { min: 40, max: 49, xp: 75 },
    { min: 50, max: 69, xp: 90 },
    { min: 70, max: 99, xp: 110 },
    { min: 100, xp: 125 },
  ],
  survival: [
    { min: 0, max: 4, xp: -1 },
    { min: 5, max: 9, xp: 10 },
    { min: 10, max: 19, xp: 20 },
    { min: 20, max: 39, xp: 40 },
    { min: 40, max: 59, xp: 60 },
    { min: 60, max: 79, xp: 90 },
    { min: 80, max: 99, xp: 100 },
    { min: 100, max: 119, xp: 110 },
    { min: 120, max: 120, xp: 125 },
  ],
  rain: [
    { min: 0, max: 4, xp: -1 },
    { min: 5, max: 9, xp: 10 },
    { min: 10, max: 24, xp: 20 },
    { min: 25, max: 39, xp: 40 },
    { min: 40, max: 54, xp: 60 },
    { min: 55, max: 69, xp: 75 },
    { min: 70, max: 99, xp: 90 },
    { min: 100, max: 134, xp: 110 },
    { min: 135, xp: 125 },
  ],
} as const satisfies Record<
  "higher-lower" | "survival" | "rain",
  readonly XpBand[]
>;

export const FEATURED_MODE_ROTATION = [
  "surge",
  "higher-lower",
  "rain",
  "trade",
  "survival",
] as const satisfies readonly Exclude<GameMode, "practice">[];

export const SEASON_PLACEMENT_XP = [
  { min: 1, max: 1, xp: 500 },
  { min: 2, max: 2, xp: 350 },
  { min: 3, max: 3, xp: 250 },
  { min: 4, max: 5, xp: 150 },
  { min: 6, max: 10, xp: 100 },
  { min: 11, max: 20, xp: 50 },
] as const satisfies readonly XpBand[];

function bandXp(bands: readonly XpBand[], rawValue: number): number {
  const value = Math.max(0, Math.floor(rawValue));
  const band = bands.find(
    ({ min, max }) => value >= min && (max === undefined || value <= max),
  );
  // The 0-4 band deliberately mirrors the exact score. Its sentinel keeps the
  // public table compact while preserving 0 XP for a zero-score completion.
  return band?.xp === -1 ? value : (band?.xp ?? 0);
}

export function gameCompletionXp(mode: GameMode, score: number): number {
  if (mode === "surge") return SURGE_COMPLETION_XP;
  if (mode === "trade") return TRADE_COMPLETION_XP;
  if (mode === "practice") return 0;
  return bandXp(PERFORMANCE_XP_BANDS[mode], score);
}

export function practiceXpForCards(
  cards: number,
  carriedCards = 0,
): { xp: number; carriedCards: number } {
  const total =
    Math.max(0, Math.floor(cards)) + Math.max(0, Math.floor(carriedCards));
  return {
    xp: Math.floor(total / PRACTICE_CARDS_PER_XP),
    carriedCards: total % PRACTICE_CARDS_PER_XP,
  };
}

export function featuredModeForDate(
  now: Date = new Date(),
): Exclude<GameMode, "practice"> {
  const day = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) /
      86_400_000,
  );
  return FEATURED_MODE_ROTATION[
    ((day % FEATURED_MODE_ROTATION.length) + FEATURED_MODE_ROTATION.length) %
      FEATURED_MODE_ROTATION.length
  ]!;
}

export function seasonPlacementXp(rank: number): number {
  return bandXp(SEASON_PLACEMENT_XP, rank);
}

// Survival's per-card window tightens as the streak grows — every run gets a
// natural climax. The curve is hyperbolic, so the clock keeps getting faster the
// deeper you go (no flat floor): a 5s opening eases toward an 800ms ultimate
// ceiling, dropping below 3s by a 10 streak, below 2s by 26, and reaching ~1.1s
// on the deck's last card (120). One curve, shared by the browser clock and the
// server scorer (small boundary tolerance).
//
// The floor is only approached at a streak of ~201, which a 120-card deck cannot
// reach, so the back half of a run tightens very little (1500ms at 50 → 1126ms
// at 119). That is reviewed and deliberate — read GAMES.md's Survival entry
// before "fixing" it.
export const SURVIVAL_BASE_WINDOW_MS = 5_000;
export const SURVIVAL_MIN_WINDOW_MS = 800;
export const SURVIVAL_WINDOW_RAMP = 10;

export function survivalWindowMs(streak: number): number {
  const span = SURVIVAL_BASE_WINDOW_MS - SURVIVAL_MIN_WINDOW_MS;
  return Math.round(
    SURVIVAL_MIN_WINDOW_MS +
      span / (1 + Math.max(0, streak) / SURVIVAL_WINDOW_RAMP),
  );
}

// Higher/Lower deliberately uses Survival's continuously tightening response
// curve. Keeping this as a direct call instead of a second copy makes the
// browser countdown and server scorer share not only one Higher/Lower function,
// but the exact tension curve the two modes promise players: 5s at the opening,
// below 3s by round 10, below 2s by round 26, and always approaching (never
// reaching) 800ms.
export function higherLowerWindowMs(round: number): number {
  return survivalWindowMs(round);
}

// Rain's spawn cadence: the gap between falling tiles tightens as the cleared
// count climbs, from RAIN_SPAWN_BASE_MS toward (never reaching) the floor —
// 1,160ms at 0 clears, ~710ms by 50, ~440ms by 200. Always positive, so it keeps
// closing without a hard limit.
//
// One curve, shared by the browser's spawn timer and the server's integrity
// floor below. Rain has no round length and no clock, so this curve is the ONLY
// thing that bounds the mode: a private copy on either side would silently
// un-bound it the moment the two drifted.
export const RAIN_SPAWN_BASE_MS = 1_160;
export const RAIN_SPAWN_FLOOR_MS = 260;
export const RAIN_SPAWN_TIGHTEN = 0.02;

export function rainSpawnIntervalMs(cleared: number): number {
  return (
    RAIN_SPAWN_FLOOR_MS +
    (RAIN_SPAWN_BASE_MS - RAIN_SPAWN_FLOOR_MS) /
      (1 + Math.max(0, cleared) * RAIN_SPAWN_TIGHTEN)
  );
}

// The cumulative spawn floor: the first `gaps` spawn intervals added up. Because
// difficulty is a deterministic function of the cleared count and the count can
// only rise by one per clear, the n-th gap is never shorter than
// rainSpawnIntervalMs(n) — so this sum is the earliest elapsed moment at which
// `gaps` spawn gaps can have passed, i.e. the earliest the tile at index `gaps`
// can appear (tile 0 spawns at 0).
//
// That makes it a real lower bound on the time behind a score: you cannot clear
// a tile that has not spawned. 10.9s for 10 clears, 44.4s for 50, 75.7s for 100,
// 124.8s for 200. Only the SPAWN curve belongs here — fall speed carries a random
// per-tile component (see Rain.tsx) and can never be part of a floor.
export function rainSpawnFloorMs(gaps: number): number {
  let total = 0;
  for (let gap = 0; gap < gaps; gap += 1) total += rainSpawnIntervalMs(gap);
  return Math.round(total);
}

// Trade's difficulty ladder: the board shape of every exchange, fixed and
// identical on every run — only the cards change. Three 1v1 openers establish
// the fundamental read (two cards, one subtraction) before anything is added,
// then boards grow one card at a time and the full 3v3 arrives only in the last
// two exchanges. Lopsided boards alternate which side is longer (1v2 then 2v1,
// 2v3 then 3v2) so the sign of the answer keeps flipping instead of settling
// into "the bigger side is always Red".
//
// One shared source: the server deals this ladder and the browser reads its
// length as the run length, so the two cannot disagree about how many exchanges
// a Trade run has.
export interface TradeBoard {
  blue: number;
  red: number;
}

export const TRADE_LADDER: readonly TradeBoard[] = [
  { blue: 1, red: 1 },
  { blue: 1, red: 1 },
  { blue: 1, red: 1 },
  { blue: 1, red: 2 },
  { blue: 2, red: 1 },
  { blue: 2, red: 2 },
  { blue: 2, red: 3 },
  { blue: 3, red: 2 },
  { blue: 3, red: 3 },
  { blue: 3, red: 3 },
];

export const TRADE_ROUNDS = TRADE_LADDER.length;

export type RunChallenge =
  | { mode: "surge"; cardIds: number[] }
  | { mode: "practice"; cardIds: number[] }
  | { mode: "survival"; cardIds: number[] }
  | { mode: "rain"; cardIds: number[] }
  | { mode: "higher-lower"; pairs: Array<[number, number]> }
  | { mode: "trade"; rounds: Array<{ blueIds: number[]; redIds: number[] }> };

export interface Season {
  id: string;
  startsAt: string;
  endsAt: string;
  durationWeeks: number;
  source?: "clash-royale" | "calendar-fallback";
  crSeasonId?: number;
  currentWeek?: number;
  daysRemainingInWeek?: number;
  periodType?: ClanWarPeriodType;
  clockUpdatedAt?: string;
}

export interface SiteStats {
  trophyRoadGames: number;
  currentSeason: Season;
  // Current front-end build id; the running app compares it to its own to
  // prompt a reload when a newer version has shipped. Absent on older stacks.
  webVersion?: string;
}

export type ClanWarPeriodType = "training" | "warDay" | "colosseum";

// The canonical Clash Royale tag shape, for players and clans alike. Supercell
// draws tags from a fixed alphabet that excludes the letter O (a typed O reads
// as a zero). Every surface that accepts or forwards a tag validates against
// this one pattern; a private copy that drifts would let a tag through one
// boundary and bounce it at the next.
export const CLASH_ROYALE_TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

export type ClashRoyaleProfileStatus =
  "pending" | "ready" | "not_found" | "unavailable";

export interface ClashRoyaleCard {
  id: number;
  name: string;
  iconUrl?: string;
}

export interface ClashRoyaleClan {
  tag: string;
  name: string;
  badgeId: number;
  role?: string;
}

export interface ClashRoyaleAccountAge {
  days?: number;
  years?: number;
}

export interface ClashRoyaleProfile {
  tag: string;
  status: ClashRoyaleProfileStatus;
  name?: string;
  clan?: ClashRoyaleClan;
  accountAge?: ClashRoyaleAccountAge;
  cards?: ClashRoyaleCard[];
  fetchedAt?: string;
  refreshRequestedAt?: string;
}

export interface CrPlayerRefreshRequest {
  version: 1;
  type: "refresh-player";
  jobId: string;
  playerTag: string;
  requestedAt: string;
}

export interface CrPlayerSnapshot {
  name: string;
  clan?: ClashRoyaleClan;
  accountAge?: ClashRoyaleAccountAge;
  cards: ClashRoyaleCard[];
}

interface CrPlayerRefreshResultBase {
  version: 1;
  type: "player-result";
  jobId: string;
  playerTag: string;
  requestedAt: string;
  completedAt: string;
}

export interface CrPlayerRefreshSuccess extends CrPlayerRefreshResultBase {
  outcome: "success";
  player: CrPlayerSnapshot;
}

export interface CrPlayerRefreshNotFound extends CrPlayerRefreshResultBase {
  outcome: "not_found";
}

// The Clash Royale API answered with a transient failure (429/5xx, timeout);
// the profile is marked unavailable instead of poisoning the request queue.
export interface CrPlayerRefreshUnavailable extends CrPlayerRefreshResultBase {
  outcome: "unavailable";
}

export type CrPlayerRefreshResult =
  CrPlayerRefreshSuccess | CrPlayerRefreshNotFound | CrPlayerRefreshUnavailable;

export interface CrWarClock {
  crSeasonId: number;
  sectionIndex: number;
  periodIndex: number;
  periodType: ClanWarPeriodType;
  seasonStartsAt: string;
  observedAt: string;
  sourceClanTag: string;
}

export interface CrWarClockResult {
  version: 1;
  type: "war-clock-result";
  clock: CrWarClock;
}

// Internal result-queue command used by the API consumer to finalize one
// historical Drop season. It shares the consumer with bridge results so the
// same retry and dead-letter behavior protects both automatic rollovers and
// explicit historical repairs.
export interface PodiumFinalizeResult {
  version: 1;
  type: "podium-finalize";
  seasonId: string;
  finalizedAt: string;
}

// Public account tags describe a player's relationship to Drop. They are
// server-owned identity metadata, never progression, authorization, or a Clash
// Royale player tag. Keep this tuple as the shared allowlist as new tag kinds
// are deliberately introduced.
export const ACCOUNT_TAGS = ["developer"] as const;
export type AccountTag = (typeof ACCOUNT_TAGS)[number];

export interface Player {
  id: string;
  email: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  accountTags?: AccountTag[];
  clashRoyale?: ClashRoyaleProfile;
  totalGames: number;
  // Lifetime Player XP (event-awarded, only climbs); drives the arena.
  xp: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
  createdAt: string;
  updatedAt: string;
  // Owner-only enforcement state. Restriction blocks ranked starts while
  // leaving Practice, account access, history, and appeal available.
  rankedAccess?: "allowed" | "restricted";
  // When the player last opened the Updates view. Account-level and server-owned
  // (not per-device); anything newer is unread. Absent until the first open.
  lastOpenedUpdates?: string;
}

// Server-derived learning history from validated run transcripts. It remains
// available for future coaching features but does not change card selection.
export interface LearningSummary {
  weakCardIds: number[];
  costAccuracy: Record<string, { seen: number; correct: number }>;
}

export type RunReviewStatus = "pending" | "reviewed" | "excluded";

const RUN_REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function compactReference(id: string, prefix: "D" | "P"): string {
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= BigInt(id.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  let value = hash & ((1n << 50n) - 1n);
  let code = "";
  for (let index = 0; index < 10; index += 1) {
    code = RUN_REFERENCE_ALPHABET[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return `#${prefix}${code}`;
}

// A compact, read-aloud reference for a canonical run UUID. It is an
// identifier, not an authenticator: referee lookup detects ambiguity and fails
// closed, while the UUID remains the storage and decision key.
export function runReference(runId: string): string {
  return compactReference(runId, "D");
}

// Player tags are the human-facing counterpart to run references. Like run
// references they are deterministic lookup aids, not authenticators; the
// canonical player UUID remains the API and storage identity.
export function playerReference(playerId: string): string {
  return compactReference(playerId, "P");
}

export interface StartedRun {
  runId: string;
  runToken: string;
  mode: GameMode;
  challenge: RunChallenge;
  // Retained for responses from historical unranked runs. New runs always use
  // the canonical catalog and rank.
  ranked?: boolean;
  // Guest runs use the same signed challenge/scoring path, but completion is
  // never persisted to a player, leaderboard, history, XP, or Trophy Road.
  guest?: true;
  expiresAt: string;
}

export interface CompletedRun {
  accepted: true;
  guest?: false;
  runId: string;
  mode: GameMode;
  score: number;
  season: Season;
  ranked?: boolean;
  completedAt: string;
  // The score was recorded but is excluded from public leaderboards pending a
  // Fair Play Referee decision. Automatic scorer flags are not final verdicts.
  underReview?: boolean;
  totalGames: number;
  xp: number;
  // The exact sources that stacked on this completion. `xpEarned` remains in
  // the JSON response during the rolling upgrade for older clients.
  xpAwards?: XpAward[];
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}

// A guest completion: the run was scored but nothing was recorded (no account,
// no leaderboard, no XP). Only the mode, score, and season come back.
export interface GuestRunCompletion {
  accepted: true;
  guest: true;
  mode: GameMode;
  score: number;
  season: Season;
}

export type RunCompletion = CompletedRun | GuestRunCompletion;

// Lifetime Player XP required to reach each of the 28 arenas. XP v2 combines
// explicit game, improvement, badge, and season awards; the ladder remains a
// genuine long-haul even though individual event value now reflects effort.
//
// This lives in contracts because BOTH surfaces need it and neither may import
// the other: apps/web renders the arena (names and art stay client-side, in
// data/starRanks.ts, which derives its thresholds from this array), and the
// Arena Climber badge resolves a player's tier server-side.
export const ARENA_XP_THRESHOLDS: readonly number[] = [
  0, 40, 100, 200, 350, 550, 800, 1_100, 1_500, 2_000, 2_600, 3_300, 4_200,
  5_300, 6_600, 8_100, 9_900, 12_000, 14_500, 17_400, 20_800, 24_800, 29_500,
  35_000, 41_500, 49_000, 58_000, 68_000,
];

// The arena number (1-28) for a lifetime XP total.
export function arenaForXp(xp: number): number {
  let arena = 1;
  for (let i = 0; i < ARENA_XP_THRESHOLDS.length; i += 1) {
    const threshold = ARENA_XP_THRESHOLDS[i];
    if (threshold === undefined || xp < threshold) break;
    arena = i + 1;
  }
  return arena;
}

// ── Badges ───────────────────────────────────────────────────────────────────
//
// A badge is ONE monotonic counter and an ordered list of rungs — not three
// tiers. A long ladder always has a next rung visible, so the badge keeps
// motivating the player who cared most, and rung one can land in a first session
// while the top rung remains a genuine long-haul target.
//
// Three counter kinds cover all 32 badges:
//   count — events, only ever climbs;      rung clears at value >= rung
//   best  — personal best, higher better;  rung clears at value >= rung
//   time  — personal best in seconds, LOWER better; rung clears at value <= rung
//
// Two invariants the engine must never break: counters only move in their
// favourable direction, and **nothing earned is ever revoked**. Awarding is
// therefore a pure function of the counters, which is what makes badges
// recomputable from history.
//
// The rungs below were calibrated against Drop's live leaderboards on
// 2026-08-02, then rechecked when a mode's format or real play-test evidence
// changed. They are NOT copied
// from the design-time proposal in the Claude Design project's `Badge Set.md`.
// That draft assumed thousands of players; Drop had 16 with a recorded Surge
// best. Its Clockbreaker ladder put five consecutive rungs (13-17s) above a 4.7s
// gap in the real field, so four of them separated nobody, while its entry rung
// excluded 31% of players outright. Where a ladder is marked "scaled", no live
// data existed for that counter and the rungs are a proportional reduction
// against the observed activity ceiling — re-check those once badge counters
// have a month of real data behind them.

export type BadgeCounterKind = "count" | "best" | "time";

export type BadgeGroup =
  | "mode-mastery"
  | "mode-skill"
  | "progression"
  | "card-knowledge"
  | "habit"
  | "community"
  | "hidden";

export interface BadgeDefinition {
  slug: string;
  name: string;
  group: BadgeGroup;
  kind: BadgeCounterKind;
  // Ascending for count/best, DESCENDING for time (each rung is harder).
  rungs: readonly number[];
  // What the medallion chip shows: "18s", "150", "2.5K" — never a roman numeral.
  unit?: "seconds" | "plain";
  // Hidden badges render as a black silhouette until earned. Their names stay
  // visible, but the earning condition, progress bar, and aggregate hidden
  // count remain secret until the badge is earned.
  hidden?: true;
  // One line shown on the detail sheet. Hidden-badge requirements are revealed
  // only after earning them.
  requirement?: string;
}

// `as const satisfies` rather than a plain annotation: the annotation alone
// would widen every `slug` to `string` and BadgeSlug would stop being a union.
export const BADGES = [
  // ── Mode mastery — volume, one per game (6). Scaled. ──────────────────────
  {
    slug: "surge-runner",
    name: "Surge Runner",
    group: "mode-mastery",
    kind: "count",
    rungs: [5, 10, 25, 50, 75, 100, 125, 150, 200, 250, 300, 450],
    requirement: "Surge runs finished",
  },
  {
    slug: "bridge-read",
    name: "Bridge Read",
    group: "mode-mastery",
    kind: "count",
    rungs: [50, 125, 300, 600, 1_200, 2_000, 3_000, 4_000, 5_000],
    requirement: "Correct reads in Higher / Lower",
  },
  {
    slug: "trade-reader",
    name: "Trade Reader",
    group: "mode-mastery",
    kind: "count",
    rungs: [3, 5, 10, 15, 25, 35, 50, 75, 100, 125, 150],
    requirement: "Trade runs finished",
  },
  {
    slug: "last-stand",
    name: "Last Stand",
    group: "mode-mastery",
    kind: "count",
    rungs: [5, 10, 25, 50, 75, 125, 200, 300, 450],
    requirement: "Survival runs finished",
  },
  {
    slug: "stormchaser",
    name: "Stormchaser",
    group: "mode-mastery",
    kind: "count",
    rungs: [75, 200, 500, 1_000, 2_000, 3_500, 5_500, 8_500, 10_000],
    requirement: "Cards cleared in Rain",
  },
  {
    slug: "reps",
    name: "Reps",
    group: "mode-mastery",
    kind: "count",
    rungs: [100, 250, 500, 1_000, 2_000, 4_000, 6_000, 8_000, 10_000],
    requirement: "Questions answered in Practice",
  },

  // ── Mode skill — proof, one per game (6). Calibrated against live boards. ──
  {
    // Measured: n=16, best 12.861s, median 25.4s, worst 67.3s. Entry rung 60s
    // catches 94% of the field; the 12s ceiling sits just past the record so
    // even the two sub-13s players still have a rung to chase.
    slug: "clockbreaker",
    name: "Clockbreaker",
    group: "mode-skill",
    kind: "time",
    rungs: [60, 50, 42, 35, 30, 26, 22, 19, 17, 15, 13, 12],
    unit: "seconds",
    requirement: "Fastest Surge run",
  },
  {
    // Current 10-exchange evidence on 2026-08-06: four accepted runs across two
    // visible players, 67.126s best / 75.591s median / 266.570s slowest. The
    // 300s opener lets that learning run land, 240s is its credible next step,
    // Tyler's best clears 72s with 65s next, and 45s stays aspirational without
    // requiring the previous four-seconds-per-exchange ceiling.
    slug: "sharp-trade",
    name: "Sharp Trade",
    group: "mode-skill",
    kind: "time",
    rungs: [
      300, 240, 200, 170, 145, 125, 110, 95, 85, 78, 72, 65, 60, 55, 50, 40,
    ],
    unit: "seconds",
    requirement: "Fastest 10-exchange Trade run",
  },
  {
    // Recalibrated for Higher/Lower r3 on 2026-08-08, then extended from the
    // live 68-card best on 2026-08-16. The original 5-50 milestones remain,
    // with 60 as the last gold step and 70 as the prismatic stretch target.
    slug: "coin-flip-killer",
    name: "Coin Flip Killer",
    group: "mode-skill",
    kind: "best",
    rungs: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70],
    requirement: "Best single Higher / Lower run",
  },
  {
    // Survival deals the 120-card catalog once and ends in a win when it is
    // cleared, so the ladder must end there. Measured current-board best: 117;
    // 110 recognizes that near-clear while leaving the real win to chase.
    slug: "unbroken",
    name: "Unbroken",
    group: "mode-skill",
    kind: "best",
    rungs: [10, 15, 25, 40, 60, 80, 100, 110, 120],
    requirement: "Longest Survival streak",
  },
  {
    // The live best reached 145 on 2026-08-16. Preserve the established early
    // ladder, then put the last gold step at 135 and prismatic at 150.
    slug: "downpour",
    name: "Downpour",
    group: "mode-skill",
    kind: "best",
    rungs: [25, 40, 55, 70, 90, 120, 135, 150],
    requirement: "Most cleared in one Rain run",
  },
  {
    slug: "clean-sweep",
    name: "Clean Sweep",
    group: "mode-skill",
    kind: "count",
    rungs: [1, 3, 5, 10, 25, 50],
    requirement: "Practice sessions of 20+ cards at 100%",
  },

  // ── Progression — the whole game (4) ──────────────────────────────────────
  {
    // Measured: highest observed totalGames 304.
    slug: "drop-regular",
    name: "Drop Regular",
    group: "progression",
    kind: "count",
    rungs: [25, 50, 100, 200, 350, 500, 750, 1_000, 1_500],
    requirement: "Total games, all modes",
  },
  {
    // Bounded by the 28-tier arena, so self-calibrating.
    slug: "arena-climber",
    name: "Arena Climber",
    group: "progression",
    kind: "best",
    rungs: [4, 7, 10, 14, 18, 21, 24, 28],
    requirement: "Arena reached",
  },
  {
    slug: "all-six",
    name: "All Six",
    group: "progression",
    kind: "best",
    rungs: [3, 4, 5, 6],
    requirement: "Distinct modes played",
  },
  {
    slug: "podium",
    name: "Podium",
    group: "progression",
    kind: "count",
    rungs: [1, 2, 3, 5, 10],
    requirement: "Top-three season finishes",
  },

  // ── Card knowledge (4). Scaled, except Catalog. ───────────────────────────
  {
    // Bounded by the catalog itself (120 cards), so self-calibrating.
    slug: "catalog",
    name: "Catalog",
    group: "card-knowledge",
    kind: "best",
    rungs: [25, 50, 75, 100, 110, 120],
    requirement: "Unique cards read correctly",
  },
  {
    slug: "spellcaster",
    name: "Spellcaster",
    group: "card-knowledge",
    kind: "count",
    rungs: [50, 125, 300, 600, 1_200, 2_500, 3_000],
    requirement: "Correct reads on spells",
  },
  {
    // Buildings are a much smaller slice of the pool, so identical rungs would
    // make this three times harder than Spellcaster for no reason.
    slug: "tower-watch",
    name: "Tower Watch",
    group: "card-knowledge",
    kind: "count",
    rungs: [25, 60, 150, 300, 600, 1_200, 2_000],
    requirement: "Correct reads on buildings",
  },
  {
    slug: "big-spender",
    name: "Big Spender",
    group: "card-knowledge",
    kind: "count",
    rungs: [50, 125, 300, 600, 1_200, 2_500, 4_000],
    requirement: "Correct reads on 6+ cost cards",
  },

  // ── Habit (2). Daily Drop counts distinct played days; Marathon records the
  // best single-day run count. Both remain monotonic. ───────────────────────
  {
    slug: "daily-drop",
    name: "Daily Drop",
    group: "habit",
    kind: "count",
    rungs: [3, 7, 14, 30, 60, 100, 180, 365],
    requirement: "Distinct days played",
  },
  {
    slug: "marathon",
    name: "Marathon",
    group: "habit",
    kind: "best",
    rungs: [5, 10, 15, 25, 40, 60, 100],
    requirement: "Most games in a single day",
  },

  // ── Community (3). Herald and Recruiter are scaled until their live
  // counters have enough history to calibrate; Battle Tag is one-time. ──────
  {
    slug: "battle-tag",
    name: "Battle Tag",
    group: "community",
    kind: "count",
    rungs: [1],
    requirement: "Add a Clash Royale player tag to your profile",
  },
  {
    slug: "herald",
    name: "Herald",
    group: "community",
    kind: "count",
    rungs: [1, 5, 10, 25, 50, 100, 250, 500],
    requirement: "Credited visitors across your shared-run links",
  },
  {
    slug: "recruiter",
    name: "Recruiter",
    group: "community",
    kind: "count",
    rungs: [1, 3, 5, 10, 25, 50],
    requirement: "New players who create an account through your shared links",
  },

  // ── Hidden — one rung, silhouette until earned (7). Six of the seven are
  // earnable in a single run: they are moments, not grinds. Only Collector is a
  // long game, and it is the only badge that requires all the others. ────────
  {
    slug: "night-shift",
    name: "Night Shift",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by completing a game between midnight and 5:00 a.m. local time.",
  },
  {
    slug: "photo-finish",
    name: "Photo Finish",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by setting a new Surge or Trade best by less than one tenth of a second.",
  },
  {
    slug: "full-cup",
    name: "Full Cup",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by clearing every 6+ elixir card on the first guess in one Surge run.",
  },
  {
    slug: "zero-hesitation",
    name: "Zero Hesitation",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by responding to every card in a Survival run in under one second.",
  },
  {
    slug: "comeback",
    name: "Comeback",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by clearing 20 cards in Rain after falling to your final life.",
  },
  {
    slug: "cold-open",
    name: "Cold Open",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by setting a new all-time best on your first completed game of the local day.",
  },
  {
    slug: "collector",
    name: "Collector",
    group: "hidden",
    kind: "count",
    rungs: [1],
    hidden: true,
    requirement:
      "Earned by unlocking at least one milestone in every other badge.",
  },
] as const satisfies readonly BadgeDefinition[];

export type BadgeSlug = (typeof BADGES)[number]["slug"];

// `BADGES` keeps its literal types so BadgeSlug is a real union — but that makes
// the optional fields (`hidden`, `unit`, `requirement`) absent from the members
// that omit them, so iterating it and reading `badge.hidden` will not compile.
// Iterate this widened view instead; use BADGES only where the literal slug
// union matters.
export const BADGE_LIST: readonly BadgeDefinition[] = BADGES;

export const BADGE_BY_SLUG = new Map(
  BADGE_LIST.map((badge) => [badge.slug, badge]),
);

// The player's position on one ladder. `rungIndex` is -1 when no rung is
// cleared; otherwise it is the index of the highest cleared rung.
export interface BadgeState {
  slug: string;
  value: number;
  rungIndex: number;
  // ISO timestamp per cleared rung, parallel to rungs[0..rungIndex].
  earnedAt: string[];
  // `time` ladders only: how many runs have landed at or under each rung. This
  // is the interesting stat — "sub-20s: 14 runs, sub-19s: 9" tells a player
  // exactly where their ceiling is and makes a fast rung feel earned.
  runsAtRung?: number[];
}

// Rim metal by ladder position, so a 12-rung and a 6-rung badge still read at a
// glance. Derived, never stored — there is no art variant per rung.
export type BadgeTier = "unlit" | "copper" | "silver" | "gold" | "prismatic";

export function badgeTier(rungIndex: number, rungCount: number): BadgeTier {
  if (rungIndex < 0) return "unlit";
  if (rungIndex >= rungCount - 1) return "prismatic";
  const progress = (rungIndex + 1) / rungCount;
  if (progress <= 1 / 3) return "copper";
  if (progress <= 2 / 3) return "silver";
  return "gold";
}

// The milestone label is public contract data: profile sheets, share previews,
// and unfurl metadata must describe the same rung with the same compact text.
export function formatBadgeRungValue(
  value: number,
  unit?: BadgeDefinition["unit"],
): string {
  if (unit === "seconds")
    return `${value % 1 === 0 ? value : value.toFixed(1)}s`;
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`;
  }
  return String(Math.round(value));
}

export const BADGE_TIER_XP = {
  copper: 5,
  silver: 10,
  gold: 25,
  prismatic: 50,
} as const satisfies Record<Exclude<BadgeTier, "unlit">, number>;
export const HIDDEN_BADGE_XP = 25;
export const COLLECTOR_BADGE_XP = 100;
export const BATTLE_TAG_XP = 100;

export function badgeRungXp(
  definition: BadgeDefinition,
  rungIndex: number,
): number {
  if (rungIndex < 0 || rungIndex >= definition.rungs.length) return 0;
  if (definition.slug === "collector") return COLLECTOR_BADGE_XP;
  if (definition.slug === "battle-tag") return BATTLE_TAG_XP;
  if (definition.hidden) return HIDDEN_BADGE_XP;
  const tier = badgeTier(rungIndex, definition.rungs.length);
  return tier === "unlit" ? 0 : BADGE_TIER_XP[tier];
}

export interface BadgeSummary {
  badges: BadgeState[];
  // True on the response that first backfilled a player's history, so the client
  // shows a one-time "here's what you've already earned" summary instead of
  // queueing forty celebrations.
  backfilled?: boolean;
}
