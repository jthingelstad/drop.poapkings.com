export {
  GAME_MODES,
  type GameMode,
  type RunChallenge,
} from "@elixir-drop/contracts";
import type {
  ClashRoyaleAccountAge,
  ClashRoyaleCard,
  ClashRoyaleClan,
  GameMode,
} from "@elixir-drop/contracts";
export type ScoreDirection = "lower" | "higher";

export interface ModeRule {
  direction: ScoreDirection;
  minScore: number;
  maxScore: number;
  scoreUnit: "milliseconds" | "count" | "percent";
}

export interface SessionClaims {
  type: "session";
  sub: string;
  iat: number;
  exp: number;
}

export interface RunClaims {
  type: "run";
  runId: string;
  owner: string;
  mode: GameMode;
  iat: number;
  exp: number;
}

export interface NameClaims {
  type: "names";
  sub: string;
  favoriteCardId: number;
  names: string[];
  iat: number;
  exp: number;
}

export type SignedClaims = SessionClaims | RunClaims | NameClaims;

export interface SurgeAnswer {
  cardId: number;
  guesses: number[];
  atMs: number;
}

export type RunTranscript = Record<string, unknown>;

export interface PlayerProfile {
  sub: string;
  playerId: string;
  email: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  totalGames: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile {
  id: string;
  publicName: string;
  favoriteCardId?: number;
  playerTag?: string;
  totalGames: number;
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}

export interface RunRecord {
  runId: string;
  mode: GameMode;
  score: number;
  seasonId: string;
  completedAt: string;
}

export interface CrProfileSnapshot {
  tag: string;
  status: "pending" | "ready" | "not_found" | "unavailable";
  jobId?: string;
  name?: string;
  clan?: ClashRoyaleClan;
  accountAge?: ClashRoyaleAccountAge;
  cards?: ClashRoyaleCard[];
  fetchedAt?: string;
  refreshRequestedAt?: string;
  updatedAt: string;
}
