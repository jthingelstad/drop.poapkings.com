// Types for the AGENT-TEAM referee helper, which is deliberately plain JS
// outside every workspace (it imports nothing from services/api). Only the
// surface the mirror test asserts against is declared here.
declare module "*/AGENT-TEAM/scripts/_referee-lib.mjs" {
  export const RANKED_MODES: string[];
  export function leaderboardPartition(seasonId: string, mode: string): string;
}
