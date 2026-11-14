import { describe, expect, it } from "vitest";
import {
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

describe("the one-time name migration", () => {
  it("names a profile by its verified primary, and retires every other made-up name", () => {
    const { plans, counts } = planNameMigration([
      {
        sub: "a",
        publicName: "Pancake Patrol",
        favoriteCardId: 26000018,
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
      { sub: "b", publicName: "Bone Parade", favoriteCardId: 26000010 },
      {
        sub: "c",
        publicName: "Skarmy Picnic",
        elixir: { candidates: [candidate({ verified: false })] },
      },
      {
        sub: "d",
        publicName: "Mini P Griddle",
        elixir: { candidates: [candidate({ relationship: "alt" })] },
      },
      {
        sub: "e",
        publicName: "King Thing",
        identityFromElixirAt: "2026-11-14T12:00:00.000Z",
      },
    ]);
    expect(counts).toEqual({
      primary_name: 1,
      no_connection: 1,
      primary_unverified: 1,
      no_primary: 1,
      already_from_elixir: 1,
    });
    expect(plans).toEqual([
      {
        sub: "a",
        primaryName: "King Thing",
        before: { publicName: "Pancake Patrol", favoriteCardId: 26000018 },
      },
      {
        sub: "b",
        before: { publicName: "Bone Parade", favoriteCardId: 26000010 },
      },
      { sub: "c", before: { publicName: "Skarmy Picnic" } },
      { sub: "d", before: { publicName: "Mini P Griddle" } },
    ]);
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
