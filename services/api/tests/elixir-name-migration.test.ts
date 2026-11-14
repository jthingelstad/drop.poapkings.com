import { describe, expect, it } from "vitest";
import {
  migrationWrite,
  parseNameMigrationArgs,
  planNameMigration,
} from "../src/maintenance/migrate-elixir-names.js";

const candidate = (extra: Record<string, unknown>) =>
  ({
    playerTag: "#20JJJ2CCRU",
    name: "King Thing",
    relationship: "primary",
    verified: true,
    ...extra,
  }) as never;

describe("the one-time identity migration", () => {
  it("names a profile by its primary, verified or not, and retires every other made-up name", () => {
    const { plans, counts } = planNameMigration([
      {
        sub: "a",
        publicName: "Pancake Patrol",
        favoriteCardId: 26000018,
        playerTag: "#20JJJ2CCRU",
        elixir: {
          candidates: [
            candidate({
              playerTag: "#2PYQ0C",
              name: "Sample Alt",
              relationship: "alt",
            }),
            candidate({}),
          ],
        },
      },
      {
        sub: "b",
        publicName: "Bone Parade",
        favoriteCardId: 26000010,
        playerTag: "#2PYQ0",
      },
      {
        sub: "c",
        publicName: "Skarmy Picnic",
        elixir: {
          candidates: [candidate({ verified: false, name: "Sample Primary" })],
        },
      },
      {
        sub: "d",
        publicName: "Mini P Griddle",
        playerTag: "#2PYQ0C",
        elixir: { candidates: [candidate({ relationship: "alt" })] },
      },
      {
        sub: "e",
        publicName: "Goblin Brunch",
        elixir: { candidates: [candidate({ name: " " })] },
      },
      {
        sub: "f",
        publicName: "King Thing",
        identityFromElixirAt: "2026-11-14T12:00:00.000Z",
      },
    ]);
    expect(counts).toEqual({
      outcomes: {
        primary_name: 2,
        primary_unnamed: 1,
        no_connection: 1,
        no_primary: 1,
        already_from_elixir: 1,
      },
      picturesCleared: 2,
      tagsCleared: 2,
    });
    expect(plans).toEqual([
      {
        sub: "a",
        primaryName: "King Thing",
        clearPlayerTag: false,
        before: {
          publicName: "Pancake Patrol",
          favoriteCardId: 26000018,
          playerTag: "#20JJJ2CCRU",
        },
      },
      {
        sub: "b",
        clearPlayerTag: true,
        before: {
          publicName: "Bone Parade",
          favoriteCardId: 26000010,
          playerTag: "#2PYQ0",
        },
      },
      {
        sub: "c",
        primaryName: "Sample Primary",
        clearPlayerTag: false,
        before: { publicName: "Skarmy Picnic" },
      },
      {
        sub: "d",
        clearPlayerTag: true,
        before: { publicName: "Mini P Griddle", playerTag: "#2PYQ0C" },
      },
      {
        sub: "e",
        clearPlayerTag: false,
        before: { publicName: "Goblin Brunch" },
      },
    ]);
  });

  it("leaves no made-up name or Drop-chosen picture behind when applied", () => {
    const { plans } = planNameMigration([
      { sub: "a", publicName: "Pancake Patrol", favoriteCardId: 26000018 },
      {
        sub: "b",
        publicName: "Skarmy Picnic",
        favoriteCardId: 26000010,
        playerTag: "#20JJJ2CCRU",
        elixir: { candidates: [candidate({ verified: false })] },
      },
    ]);
    const writes = plans.map(migrationWrite);
    // No primary name: the stored name is removed, so Drop shows
    // "Elixir Player"; every picture is cleared.
    expect(writes[0]).toEqual({
      identity: { avatarCardId: null },
      options: { firstTimeOnly: true, clearPlayerTag: false },
    });
    expect(writes[1]).toEqual({
      identity: { primaryName: "King Thing", avatarCardId: null },
      options: { firstTimeOnly: true, clearPlayerTag: false },
    });
    for (const write of writes) {
      expect(write.identity).not.toHaveProperty("publicName");
      expect(write.identity.avatarCardId).toBeNull();
      expect(write.options.firstTimeOnly).toBe(true);
    }
  });

  it("tidies a stored name from before the adapter tidied names", () => {
    const rlo = String.fromCodePoint(0x202e);
    const { plans } = planNameMigration([
      {
        sub: "a",
        elixir: { candidates: [candidate({ name: ` Sample${rlo}\nPlayer ` })] },
      },
    ]);
    expect(plans[0]?.primaryName).toBe("Sample Player");
  });

  it("is a dry run unless told to apply", () => {
    expect(parseNameMigrationArgs([], {})).toEqual({
      apply: false,
      tableName: "elixir-drop",
    });
    expect(parseNameMigrationArgs(["--apply", "--table", "t"], {})).toEqual({
      apply: true,
      tableName: "t",
    });
    expect(() => parseNameMigrationArgs(["--force"], {})).toThrow(/Unknown/);
  });
});
