export type ReviewQueueItem = {
  runId: string;
  runReference: string;
  playerId?: string;
  playerReference?: string;
  publicName?: string;
  mode?: string;
  score?: number;
  completedAt?: string;
  decidedAt?: string;
  reason?: string;
  subjectType?: string;
};

export type PlayerSummary = {
  playerId: string;
  playerReference: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  email?: string;
  lastLoginAt?: string;
  clashName?: string;
  clanName?: string;
  clanTag?: string;
  totalGames: number;
  xp: number;
  createdAt?: string;
  updatedAt?: string;
  lastSeen?: string;
  runCount: number;
  modes: Record<string, number>;
  reviewedRuns: number;
  pendingRuns: number;
  excludedRuns: number;
  earnedBadges: number;
  rankedAccess: "allowed" | "restricted";
};

export type RecentRun = ReviewQueueItem;

export type Overview = {
  status: "ok";
  generatedAt: string;
  operator: string;
  csrfToken: string;
  totals: {
    players: number;
    runs: number;
    pending: number;
    restricted: number;
  };
  players: PlayerSummary[];
  reviewQueue: ReviewQueueItem[];
  recentRuns: RecentRun[];
};

export type PlayerDetail = {
  status: "ok";
  playerId: string;
  playerReference: string;
  player: Record<string, unknown>;
  account: {
    playerId?: string;
    email?: string;
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    totalGames?: number;
    xp?: number;
    createdAt?: string;
    updatedAt?: string;
    lastLoginAt?: string;
  };
  clashRoyale?: {
    tag: string;
    status: string;
    name?: string;
    clan?: { tag?: string; name?: string; role?: string };
    accountAge?: { days?: number; years?: number };
    cardCount?: number;
    fetchedAt?: string;
    refreshRequestedAt?: string;
    updatedAt?: string;
  };
  changes: Array<{
    playerId?: string;
    changedFields?: string[];
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string;
    operator?: string;
    changedAt?: string;
  }>;
  badges: {
    earned?: Record<string, string[]>;
    values?: Record<string, number>;
  };
  rankedAccess: {
    status: "allowed" | "restricted";
    reason?: string;
    decidedAt?: string;
  };
  totalRuns: number;
  firstSeen?: string;
  lastSeen?: string;
  progression: Record<
    string,
    Array<{
      runId: string;
      runReference: string;
      score: number;
      completedAt: string;
      seasonId?: string;
      timeMs?: number;
      decision?: Record<string, unknown>;
    }>
  >;
};

export type RunDetail = {
  status: "ok";
  runReference: string;
  run: Record<string, unknown> & {
    runId: string;
    playerId: string;
    mode?: string;
    score?: number;
    completedAt?: string;
  };
  decision?: Record<string, unknown>;
};

export type BulkDecisionResult = {
  status: "ok" | "partial";
  requested: number;
  succeeded: Array<{ runId: string; runReference?: string }>;
  failed: Array<{ runId: string; detail: string }>;
};
