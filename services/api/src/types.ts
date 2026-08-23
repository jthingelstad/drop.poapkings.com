export {
  GAME_MODES,
  type GameMode,
  type RunChallenge,
} from "@elixir-drop/contracts";
import type {
  AccountTag,
  ClashRoyaleAccountAge,
  ClashRoyaleCard,
  ClashRoyaleClan,
  ClashRoyaleProfile,
  CrWarClock,
  GameMode,
  RunChallenge,
  XpAward,
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

export interface TimingEvidence {
  model: "inferred-v1" | "observed-v2" | "invalid-v2";
  inputCount: number;
  activeTotalMs?: number;
  activeMedianMs?: number;
  activeP10Ms?: number;
  under100MsCount?: number;
  under150MsCount?: number;
  longestUnder200MsStreak?: number;
  inputKindCounts?: Record<string, number>;
  untrustedInputCount?: number;
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
  // Lifetime Player XP (event-awarded, only climbs). Absent on profiles
  // created before XP shipped — treat as 0.
  xp?: number;
  // Community badge counters. Herald counts privacy-preserving distinct opens
  // of shared runs; Recruiter counts attributed new account creations. Both
  // are monotonic and owner-internal.
  heraldOpens?: number;
  recruiterCount?: number;
  // Internal last-touch recruitment attribution. Never returned by an API.
  recruitedBy?: string;
  recruiterCreditedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Successful magic-link redemption, kept separate from profile mutation and
  // gameplay activity so private account administration can distinguish them.
  lastLoginAt?: string;
  // When the player last opened the Updates view. Account-level and server-owned
  // (deliberately not per-device): anything newer than this is unread. Absent
  // until the first open.
  lastOpenedUpdates?: string;
}

export type RankedAccessStatus = "allowed" | "restricted";

// Player-level enforcement is a separate, reversible overlay. It can stop
// future ranked play without deleting the account, its history, or evidence.
export interface RankedAccessDecision {
  pk: string; // REFEREE#PLAYER#{playerId}
  sk: "CURRENT" | `DECISION#${string}`;
  playerId: string;
  status: RankedAccessStatus;
  reason: string;
  decidedAt: string;
  decidedBy: "jamie";
  schemaVersion: "1";
}

export interface PublicProfile {
  id: string;
  publicName: string;
  favoriteCardId?: number;
  playerTag?: string;
  accountTags?: AccountTag[];
  // Public profiles expose identity only; owner-only CR context such as
  // account age and collection data stays on GET /me.
  clashRoyale?: Pick<ClashRoyaleProfile, "tag" | "status" | "name" | "clan">;
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
  // All XP that stacked on this completion. Surfaced in the run sheet.
  xp?: number;
  xpAwards?: XpAward[];
  // The badge slugs whose rungs this run cleared, written best-effort after
  // completion. Surfaced as "Rungs moved" medallions in the run sheet.
  rungs?: string[];
  // Bounded, public-safe chart projection derived from the validated
  // transcript. It is retained with history so a run can be shared long after
  // the private referee evidence reaches its TTL.
  shareVisual?: RunShareVisual;
}

// One immutable non-run XP award retained under PLAYER#{sub}/XP#.... Practice's
// rolling odd-card carry shares that prefix but has no award/awardedAt and is
// deliberately filtered out by the repository read.
export interface XpAwardMarker {
  award: XpAward;
  awardedAt: string;
}

export interface RunShareVisual {
  mode: Exclude<GameMode, "practice">;
  unit: string;
  values: number[];
  refs?: number[];
  bad?: boolean[];
}

export type RunReviewStatus = "pending" | "reviewed" | "excluded";

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
  timing?: TimingEvidence;
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

export type PlayerExplanationCode =
  | "automated_input"
  | "response_timing"
  | "altered_play_record"
  | "ranked_rules"
  | "combined_evidence";

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
  // Safe, categorical owner explanation. The detailed reason above stays on
  // the private referee surface and is never copied into player responses.
  playerExplanationCode?: PlayerExplanationCode;
  // A referee can reopen an earlier judgment as a neutral queue hold. This
  // remains distinct from an excluded run even though both are hidden.
  queueState?: "pending";
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
