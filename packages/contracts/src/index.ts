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
