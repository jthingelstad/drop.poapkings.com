import { gameCompletionXp } from "@elixir-drop/contracts";
import type { XpAward } from "@elixir-drop/contracts";
import type { GameMode } from "./types.js";

const GAME_LABELS: Record<GameMode, string> = {
  surge: "Surge completion",
  practice: "Practice cards",
  "higher-lower": "Higher / Lower performance",
  trade: "Trade completion",
  survival: "Survival performance",
  rain: "Rain performance",
};

// API-facing wrapper around the shared v2 contract. Practice is completed by
// Repository with its persisted odd-card carry, so it intentionally returns 0
// here; every other mode is fully determined by its server-validated score.
export function runXp(mode: GameMode, score: number): number {
  return gameCompletionXp(mode, score);
}

export function runXpAward(mode: GameMode, amount: number): XpAward {
  return {
    source: mode === "practice" ? "practice" : "game",
    label: GAME_LABELS[mode],
    amount,
  };
}
