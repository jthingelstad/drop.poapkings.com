export {
  GAME_MODES,
  type GameMode,
  type RunChallenge,
} from "@elixir-drop/contracts";
import type {
  ClashRoyaleAccountAge,
  ClashRoyaleCard,
  ClashRoyaleClan,
  CrWarClock,
  GameMode,
  RunChallenge,
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
  // A guest run is scored on completion but never recorded (no session, no
  // profile, no leaderboard). Absent means an ordinary signed-in run.
  guest?: boolean;
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
  // Lifetime Player XP (correctness-weighted, only climbs). Absent on profiles
  // created before XP shipped — treat as 0.
  xp?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile {
  id: string;
  publicName: string;
  favoriteCardId?: number;
  playerTag?: string;
  totalGames: number;
  // Lifetime Player XP; drives the player's arena tier.
  xp: number;
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

// Non-reversible connection-correlation signals derived from a request's IP and
// user-agent. The raw IP/user-agent are NEVER stored — only these peppered
// HMACs and a coarse UA family string. See referee-evidence.ts.
export interface Correlation {
  ipHash?: string;
  ipSubnetHash?: string;
  uaHash?: string;
  uaFamily?: string;
}

// Referee-grade evidence for one recorded (ranked) or scorer-rejected signed-in
// run. Ranked evidence may be accepted immediately or automatically quarantined
// for referee review.
// Co-located under the player partition (PLAYER#{sub}) so account deletion
// sweeps it automatically. Contains NO email. Scripts map sub -> playerId on the
// way out; the referee never sees sub.
export interface EvidenceItem {
  pk: string; // PLAYER#{sub}
  sk: string; // EVIDENCE#{completedAt}#{runId}
  runId: string;
  playerSub: string;
  mode: GameMode;
  seasonId: string;
  runType: "ranked" | "rejected";
  // "accepted" for a clear ranked run, or the integrity/scorer reason string.
  integrityOutcome: string;
  score?: number;
  tiebreakMs?: number;
  challenge: RunChallenge;
  transcript: RunTranscript;
  startedAt: string;
  completedAt: string;
  wallElapsedMs: number;
  scoringVersion: { web?: string; rules: string };
  correlation: { start?: Correlation; complete: Correlation };
  playerTag?: string;
  schemaVersion: "1";
  // Epoch seconds; DynamoDB TTL sweeps the item after the review window.
  expiresAt: number;
}

export type RefereeDisposition =
  "clear" | "watch" | "review" | "insufficient_evidence";

export type RefereeVisibility = "visible" | "hidden";

// Independent referee judgment for a ranked run. The current item controls
// public leaderboard visibility; immutable DECISION# history items provide the
// audit trail. Scores, transcripts, and player records remain untouched.
export interface RefereeDecision {
  pk: string; // REFEREE#{runId}
  sk: "CURRENT" | `DECISION#${string}`;
  runId: string;
  disposition: RefereeDisposition;
  visibility: RefereeVisibility;
  reason: string;
  evidenceDigest: string;
  decidedAt: string;
  decidedBy: "fair-play-referee" | "integrity-gate";
  schemaVersion: "1";
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

export interface StoredCrWarClock extends CrWarClock {
  leaderboardSeasonId: string;
  updatedAt: string;
}
