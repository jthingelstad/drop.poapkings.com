import { describe, expect, it } from "vitest";
import { parsePodiumFinalizeResult } from "../src/cr-results.js";

// The player and war-clock result contracts went with the bridge: the API
// reads both from Elixir MCP now. Podium finalization is the one message
// still carried here, as a direct repair command.
describe("season repair results", () => {
  it("accepts a bounded historical podium finalization contract", () => {
    expect(
      parsePodiumFinalizeResult({
        version: 1,
        type: "podium-finalize",
        seasonId: "2026-07-134",
        finalizedAt: "2026-08-03T10:12:48.768Z",
      }),
    ).toEqual({
      version: 1,
      type: "podium-finalize",
      seasonId: 134,
      finalizedAt: "2026-08-03T10:12:48.768Z",
    });
    expect(() =>
      parsePodiumFinalizeResult({
        version: 1,
        type: "podium-finalize",
        seasonId: "../../etc",
        finalizedAt: "2026-08-03T10:12:48.768Z",
      }),
    ).toThrow("Season ID is invalid");
  });
});
