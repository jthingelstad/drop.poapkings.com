import type { AccountTag } from "@elixir-drop/contracts";

// Account tags are public identity metadata, keyed by Drop's permanent public
// player UUID. They are never an authorization check: adding a tag grants no
// API capability, XP, badge, leaderboard treatment, or referee status.
const ACCOUNT_TAGS_BY_PLAYER_ID: Readonly<
  Record<string, readonly AccountTag[]>
> = {
  // Jamie
  "dedcd791-38e5-4c5b-9b41-19ee7345edd2": ["developer"],
  // Tyler
  "3d63654b-0da0-40af-b298-5814c7a0939c": ["developer"],
};

export function accountTagsForPlayerId(playerId: string): AccountTag[] {
  return [...(ACCOUNT_TAGS_BY_PLAYER_ID[playerId] ?? [])];
}
