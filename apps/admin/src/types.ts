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
