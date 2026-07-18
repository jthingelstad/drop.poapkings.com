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
}

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

export type CrPlayerRefreshResult =
  CrPlayerRefreshSuccess | CrPlayerRefreshNotFound;

export interface Player {
  id: string;
  email: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  clashRoyale?: ClashRoyaleProfile;
  totalGames: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
  createdAt: string;
  updatedAt: string;
}

export interface StartedRun {
  runId: string;
  runToken: string;
  mode: GameMode;
  challenge: RunChallenge;
  expiresAt: string;
}

export interface CompletedRun {
  accepted: true;
  runId: string;
  mode: GameMode;
  score: number;
  season: Season;
  completedAt: string;
  totalGames: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}
