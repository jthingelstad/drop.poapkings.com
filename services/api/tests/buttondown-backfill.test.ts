import { describe, expect, it } from "vitest";
import {
  desiredButtondownBackfillMetadata,
  managedButtondownMetadataMatches,
  mergeButtondownBackfillMetadata,
  parseButtondownBackfillArgs,
} from "../src/maintenance/buttondown-backfill.js";

describe("Buttondown metadata backfill", () => {
  const playerId = "11111111-1111-4111-8111-111111111111";
  const appUrl = "https://drop.example";
  const inviteUrl = `${appUrl}/share/P7H47PSTT93/invite`;
  it("parses a dry-run by default and requires values for bounded inputs", () => {
    expect(parseButtondownBackfillArgs([], {})).toEqual({
      apply: false,
      envFile: undefined,
      tableName: "elixir-drop",
    });
    expect(
      parseButtondownBackfillArgs(
        ["--apply", "--env-file", "/secure/drop.env", "--table", "drop"],
        {},
      ),
    ).toEqual({
      apply: true,
      envFile: "/secure/drop.env",
      tableName: "drop",
    });
    expect(() => parseButtondownBackfillArgs(["--table"], {})).toThrow(
      "--table requires a value",
    );
    expect(() => parseButtondownBackfillArgs(["--details"], {})).toThrow(
      "Unknown argument",
    );
  });

  it("builds segment metadata from the retained profile and CR snapshot", () => {
    expect(
      desiredButtondownBackfillMetadata(
        {
          email: "player@example.com",
          playerId,
          playerTag: "#2PYQ0",
          totalGames: 42,
        },
        appUrl,
        {
          status: "ready",
          clan: {
            tag: "#J2RGCRVG",
            name: "POAP KINGS",
            badgeId: 16000000,
          },
        },
      ),
    ).toEqual({
      source: "elixir-drop-magic-link",
      player_tag: "#2PYQ0",
      drop_player_tag: "#P7H47PSTT93",
      recruiter_url: inviteUrl,
      clan_tag: "#J2RGCRVG",
      clan_name: "POAP KINGS",
      total_games: 42,
    });
  });

  it("preserves unrelated and last-known clan metadata when the snapshot is unavailable", () => {
    const desired = desiredButtondownBackfillMetadata(
      {
        email: "player@example.com",
        playerId,
        playerTag: "#2PYQ0",
        totalGames: 43,
      },
      appUrl,
      { status: "unavailable" },
    );
    expect(
      mergeButtondownBackfillMetadata(
        {
          first_name: "King",
          clan_tag: "#OLD",
          clan_name: "Old Clan",
          total_games: 42,
        },
        desired,
      ),
    ).toEqual({
      first_name: "King",
      source: "elixir-drop-magic-link",
      player_tag: "#2PYQ0",
      drop_player_tag: "#P7H47PSTT93",
      recruiter_url: inviteUrl,
      clan_tag: "#OLD",
      clan_name: "Old Clan",
      total_games: 43,
    });
  });

  it("clears known missing identity and skips an already-current subscriber", () => {
    const desired = desiredButtondownBackfillMetadata(
      {
        email: "player@example.com",
        playerId,
        totalGames: 7,
      },
      appUrl,
    );
    const current = {
      source: "elixir-drop-magic-link",
      player_tag: null,
      drop_player_tag: "#P7H47PSTT93",
      recruiter_url: inviteUrl,
      clan_tag: null,
      clan_name: null,
      total_games: 7,
      retained: true,
    };
    expect(desired).toEqual({
      source: "elixir-drop-magic-link",
      player_tag: null,
      drop_player_tag: "#P7H47PSTT93",
      recruiter_url: inviteUrl,
      clan_tag: null,
      clan_name: null,
      total_games: 7,
    });
    expect(managedButtondownMetadataMatches(current, desired)).toBe(true);
    expect(mergeButtondownBackfillMetadata(current, desired)).toBeUndefined();
  });
});
