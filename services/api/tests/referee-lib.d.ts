// Types for the AGENT-TEAM referee helper, which is deliberately plain JS
// outside every workspace (it imports nothing from services/api). Only the
// surface the mirror test asserts against is declared here.
declare module "*/AGENT-TEAM/scripts/_referee-lib.mjs" {
  export const TABLE_NAME: string;
  export const RANKED_MODES: string[];
  export const FORBIDDEN_KEYS: readonly string[];
  export function leaderboardPartition(seasonId: string, mode: string): string;
  export function leaderboardSortKey(
    mode: string,
    score: number,
    completedAt: string,
    sub: string,
    tiebreakMs?: number,
  ): string;
  export function isLeaderboardEligibleScore(score: number): boolean;
  export function rowSortKey(
    row: Record<string, unknown>,
    mode: string,
  ): string;
  export function sanitize(
    item: Record<string, unknown>,
    playerId: string,
  ): Record<string, unknown>;
  export function sanitizeRecord(
    item: Record<string, unknown>,
  ): Record<string, unknown>;
  export function bestVisibleRun(
    doc: { send: (command: unknown) => Promise<Record<string, unknown>> },
    playerSub: string,
    mode: string,
    hiddenRunId: string,
  ): Promise<Record<string, unknown> | undefined>;
  export function resolveAllTimeEarningRun(
    doc: { send: (command: unknown) => Promise<Record<string, unknown>> },
    row: Record<string, unknown>,
    mode: string,
  ): Promise<Record<string, unknown>>;
  export function visibleLeaderboardRows(
    doc: { send: (command: unknown) => Promise<Record<string, unknown>> },
    seasonId: string,
    mode: string,
    scope: "season" | "all-time",
    limit: number,
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    decisions: Map<string, Record<string, unknown>>;
  }>;
}
