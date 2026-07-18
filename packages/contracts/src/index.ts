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

export interface Player {
  id: string;
  email: string;
  publicName?: string;
  playerTag?: string;
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
  authenticated: boolean;
  expiresAt: string;
}

export interface CompletedRun {
  accepted: true;
  authenticated: boolean;
  runId: string;
  mode: GameMode;
  score: number;
  season: Season;
  completedAt: string;
  totalGames?: number;
  level?: number;
  levelStartGames?: number;
  nextLevelGames?: number;
}
