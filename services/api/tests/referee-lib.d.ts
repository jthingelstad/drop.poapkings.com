// Types for the root scripts/ referee helper, which is deliberately plain JS
// outside every workspace (it imports nothing from services/api). Only the
// surface the referee regression tests assert against is declared here.
declare module "*/scripts/_referee-lib.mjs" {
  export const TABLE_NAME: string;
  export const FORBIDDEN_KEYS: readonly string[];
  export function runReference(runId: string): string;
  export function playerReference(playerId: string): string;
  export function findEvidenceByRunId(
    doc: { send: (command: unknown) => Promise<Record<string, unknown>> },
    runIdentifier: string,
  ): Promise<Record<string, unknown> | undefined>;
  export function isExcludedFromBoards(
    decision: Record<string, unknown> | undefined,
  ): boolean;
  export function sanitize(
    item: Record<string, unknown>,
    playerId: string,
  ): Record<string, unknown>;
  export function sanitizeRecord(
    item: Record<string, unknown>,
  ): Record<string, unknown>;
}
