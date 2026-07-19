export const GAME_MODES = [
  "surge",
  "practice",
  "identify",
  "higher-lower",
  "trade",
  "ladder",
  "endless-ladder",
  "cost-sweep",
  "blitz",
  "survival",
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

// Survival's per-card window tightens as the streak grows — every run gets a
// natural climax. The curve is hyperbolic, so the clock keeps getting faster the
// deeper you go (no flat floor): a 5s opening eases toward an 800ms ultimate
// ceiling, dropping below 2s around a 40 streak and near 1.1s by 167. One curve,
// shared by the browser clock and the server scorer (small boundary tolerance).
export const SURVIVAL_BASE_WINDOW_MS = 5_000;
export const SURVIVAL_MIN_WINDOW_MS = 800;
export const SURVIVAL_WINDOW_RAMP = 15;

export function survivalWindowMs(streak: number): number {
  const span = SURVIVAL_BASE_WINDOW_MS - SURVIVAL_MIN_WINDOW_MS;
  return Math.round(
    SURVIVAL_MIN_WINDOW_MS +
      span / (1 + Math.max(0, streak) / SURVIVAL_WINDOW_RAMP),
  );
}

// Higher/Lower's response clock: 5s to read the first pair, 250ms less each
// round it survives, down to a 2s floor (reached at round 12). One curve shared
// by the browser countdown and the server scorer (small boundary tolerance).
export const HIGHER_LOWER_BASE_WINDOW_MS = 5_000;
export const HIGHER_LOWER_SHRINK_PER_ROUND_MS = 250;
export const HIGHER_LOWER_MIN_WINDOW_MS = 2_000;

export function higherLowerWindowMs(round: number): number {
  return Math.max(
    HIGHER_LOWER_MIN_WINDOW_MS,
    HIGHER_LOWER_BASE_WINDOW_MS - HIGHER_LOWER_SHRINK_PER_ROUND_MS * round,
  );
}

export type RunChallenge =
  | { mode: "surge"; cardIds: number[] }
  | { mode: "practice"; cardIds: number[] }
  | { mode: "identify"; cardIds: number[] }
  | { mode: "blitz"; cardIds: number[] }
  | { mode: "survival"; cardIds: number[] }
  | { mode: "higher-lower"; pairs: Array<[number, number]> }
  | { mode: "trade"; rounds: Array<{ blueIds: number[]; redIds: number[] }> }
  | { mode: "ladder"; cardIds: number[] }
  | { mode: "endless-ladder"; startingIds: number[]; cardIds: number[] }
  | {
      mode: "cost-sweep";
      boards: Array<{ targetElixir: number; cardIds: number[] }>;
    };

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

export interface Player {
  id: string;
  email: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  clashRoyale?: ClashRoyaleProfile;
  totalGames: number;
  // Lifetime Player XP (correctness-weighted, only climbs); drives the arena.
  xp: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
  createdAt: string;
  updatedAt: string;
}

// Server-derived learning history from validated run transcripts. It remains
// available for future coaching features but does not change card selection.
export interface LearningSummary {
  weakCardIds: number[];
  costAccuracy: Record<string, { seen: number; correct: number }>;
}

export interface StartedRun {
  runId: string;
  runToken: string;
  mode: GameMode;
  challenge: RunChallenge;
  // Retained for responses from historical unranked runs. New runs always use
  // the canonical catalog and rank.
  ranked?: boolean;
  expiresAt: string;
}

export interface CompletedRun {
  accepted: true;
  runId: string;
  mode: GameMode;
  score: number;
  season: Season;
  ranked?: boolean;
  completedAt: string;
  totalGames: number;
  xp: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}

export interface QuarantinedRun {
  accepted: false;
  reviewStatus: "pending";
  runId: string;
  mode: GameMode;
  score: number;
  season: Season;
  completedAt: string;
  totalGames: number;
  xp: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}

export type RunCompletion = CompletedRun | QuarantinedRun;
