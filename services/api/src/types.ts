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

// The run attributes that can act as an ascending leaderboard tiebreak. The
// per-mode ORDER lives with the sort key, in games.ts (MODE_TIEBREAKS).
export type TiebreakField =
  "avgLatencyMs" | "livesLost" | "timeMs" | "wrongGuesses";
export type RunTiebreaks = Partial<Record<TiebreakField, number>>;

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
  // Stored for server-side badge recovery and aggregate analysis. Deliberately
  // omitted by runRecordResponse, so it is not part of public run history.
  answerCount?: number;
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

// Referee-grade evidence for one recorded ranked run or an unscored signed-in
// attempt. Scoreable scorer/integrity assumptions become automatic referee
// quarantine signals rather than final rejection.
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
  // "rejected" is retained for evidence written by pre-v2 scorers.
  runType: "ranked" | "unscored" | "rejected";
  // "accepted" for a clear ranked run, an automatic-review reason, or why no
  // comparable candidate score could be derived.
  integrityOutcome: string;
  // Machine-readable assumptions that sent a deterministically scored run to
  // referee review. Empty/absent means no automatic flag.
  reviewSignals?: string[];
  score?: number;
  // Ordered leaderboard tiebreak values, by field name. Evidence written before
  // 2026-07-25 carries the older flat `tiebreakMs` instead.
  tiebreaks?: RunTiebreaks;
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

export type RefereeVisibility = "visible" | "hidden" | "not_ranked";

// Independent referee judgment for a ranked run or unscored attempt. The
// current item controls public leaderboard visibility when a candidate score
// exists; `not_ranked` records an authoritative judgment without inventing a
// score. Immutable DECISION# items provide the audit trail.
export interface RefereeDecision {
  pk: string; // REFEREE#{runId}
  sk: "CURRENT" | `DECISION#${string}`;
  runId: string;
  subjectType: "ranked_run" | "unscored_attempt";
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
