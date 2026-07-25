import { describe, expect, it } from "vitest";
import { GAME_MODES } from "@elixir-drop/contracts";
import { leaderboardPartition } from "../src/games.js";
// The AGENT-TEAM referee scripts deliberately import nothing from services/api
// (workspace-boundary rule), so they carry their own copy of RANKED_MODES and
// BOARD_EPOCH. A copy is only safe if something fails when it drifts: a stale
// mirror reads the wrong leaderboard partition and returns an EMPTY cohort,
// which reads as "nothing to review" rather than as a bug. Rain shipped ranked
// but missing from RANKED_MODES, so referee reviews silently skipped the mode
// entirely until 2026-07-24. This test is the guard for both failure modes.
import {
  RANKED_MODES,
  leaderboardPartition as scriptsLeaderboardPartition,
} from "../../../AGENT-TEAM/scripts/_referee-lib.mjs";

// Practice is unranked by design and never writes a leaderboard row.
const UNRANKED_MODES = new Set(["practice"]);

describe("referee scripts mirror the API leaderboard conventions", () => {
  it("covers every ranked game mode", () => {
    const expected = GAME_MODES.filter((mode) => !UNRANKED_MODES.has(mode));
    expect([...RANKED_MODES].sort()).toEqual([...expected].sort());
  });

  it("resolves the same partition as the API for every mode and scope", () => {
    for (const mode of RANKED_MODES) {
      for (const seasonId of ["ALLTIME", "2026-07"]) {
        expect(scriptsLeaderboardPartition(seasonId, mode)).toBe(
          leaderboardPartition(seasonId, mode as (typeof GAME_MODES)[number]),
        );
      }
    }
  });

  it("keeps the modes that were reset onto their current board epoch", () => {
    // Guards the epochs themselves: dropping one silently resurrects a retired
    // board (Survival's pre-rework scores, Rain's pre-difficulty-redesign ones).
    expect(scriptsLeaderboardPartition("2026-07", "survival")).toBe(
      "LEADERBOARD#2026-07#survival#r2",
    );
    expect(scriptsLeaderboardPartition("2026-07", "rain")).toBe(
      "LEADERBOARD#2026-07#rain#r2",
    );
  });
});
