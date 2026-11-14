import { describe, expect, it } from "vitest";
import {
  assertOutsideRepository,
  avatarExportDocument,
  isCloudEngineerIdentity,
  parseAvatarExportArgs,
  planAvatarExport,
} from "../src/maintenance/export-elixir-avatars.js";

const ACCT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACCT_C = "cccccccc-0000-4000-8000-000000000003";
const KNIGHT = 26000000;
const FIREBALL = 28000000;

describe("profile image export", () => {
  it("lists account id and card id for every profile that has both, and nothing else", () => {
    const { avatars, skipped } = planAvatarExport([
      { elixirAccountId: ACCT_B, favoriteCardId: FIREBALL },
      { elixirAccountId: ACCT_A, favoriteCardId: KNIGHT },
      { favoriteCardId: KNIGHT },
      { elixirAccountId: ACCT_C },
      { elixirAccountId: "not-a-uuid", favoriteCardId: KNIGHT },
    ]);
    expect(avatars).toEqual([
      { elixirAccountId: ACCT_A, favoriteCardId: KNIGHT },
      { elixirAccountId: ACCT_B, favoriteCardId: FIREBALL },
    ]);
    expect(skipped).toMatchObject({ no_elixir_account: 2, no_card: 1 });
    for (const entry of avatars)
      expect(Object.keys(entry).sort()).toEqual([
        "elixirAccountId",
        "favoriteCardId",
      ]);
  });

  it("leaves out a card Drop's catalog does not hold, or a non-integer", () => {
    const { avatars, skipped } = planAvatarExport([
      { elixirAccountId: ACCT_A, favoriteCardId: 159000000 },
      { elixirAccountId: ACCT_B, favoriteCardId: "26000000" },
      { elixirAccountId: ACCT_C, favoriteCardId: 26000000.5 },
    ]);
    expect(avatars).toEqual([]);
    expect(skipped.card_not_in_catalog).toBe(3);
  });

  it("refuses to guess when one account appears on two profiles or the link disagrees", () => {
    const { avatars, skipped } = planAvatarExport([
      { elixirAccountId: ACCT_A, favoriteCardId: KNIGHT },
      { elixirAccountId: ACCT_A.toUpperCase(), favoriteCardId: FIREBALL },
      {
        elixirAccountId: ACCT_B,
        linkAccountId: ACCT_C,
        favoriteCardId: KNIGHT,
      },
      {
        elixirAccountId: ACCT_C,
        linkAccountId: ACCT_C,
        favoriteCardId: KNIGHT,
      },
    ]);
    expect(avatars).toEqual([
      { elixirAccountId: ACCT_C, favoriteCardId: KNIGHT },
    ]);
    expect(skipped.account_on_two_profiles).toBe(2);
    expect(skipped.link_names_other_account).toBe(1);
  });

  it("writes a document of ids only", () => {
    const document = avatarExportDocument(
      {
        avatars: [{ elixirAccountId: ACCT_A, favoriteCardId: KNIGHT }],
        skipped: {
          no_elixir_account: 0,
          no_card: 0,
          card_not_in_catalog: 0,
          link_names_other_account: 0,
          account_on_two_profiles: 0,
        },
      },
      new Date("2026-11-14T12:00:00Z"),
    );
    expect(document).toEqual({
      kind: "drop-profile-images",
      version: 1,
      generatedAt: "2026-11-14T12:00:00.000Z",
      cardIds: "clash-royale",
      count: 1,
      avatars: [{ elixirAccountId: ACCT_A, favoriteCardId: KNIGHT }],
    });
    expect(JSON.stringify(document)).not.toMatch(/@|#|PLAYER|sub/);
  });

  it("accepts only the cloud-engineer session in Jamie's account", () => {
    const arn =
      "arn:aws:sts::999153317627:assumed-role/ProjectsCloudEngineer/projects-cloud-engineer";
    expect(isCloudEngineerIdentity({ Account: "999153317627", Arn: arn })).toBe(
      true,
    );
    expect(isCloudEngineerIdentity({ Account: "111111111111", Arn: arn })).toBe(
      false,
    );
    for (const other of [
      "arn:aws:sts::999153317627:assumed-role/ProjectsCloudEngineer/someone-else",
      "arn:aws:sts::999153317627:assumed-role/AWSReservedSSO_Admin/jamie",
      "arn:aws:iam::999153317627:user/elixir-drop",
      "arn:aws:sts::999153317627:assumed-role/elixir-drop-github-deploy/ci",
    ])
      expect(
        isCloudEngineerIdentity({ Account: "999153317627", Arn: other }),
      ).toBe(false);
  });

  it("requires --out, resolves it from where the operator typed, and refuses the repository", () => {
    expect(() => parseAvatarExportArgs([], {})).toThrow(/--out is required/);
    expect(() => parseAvatarExportArgs(["--out"], {})).toThrow(
      /requires a value/,
    );
    expect(() => parseAvatarExportArgs(["--apply"], {})).toThrow(/Unknown/);
    const args = parseAvatarExportArgs(["--out", "avatars.json"], {
      INIT_CWD: "/home/operator",
    });
    expect(args).toEqual({
      out: "/home/operator/avatars.json",
      tableName: "elixir-drop",
    });
    expect(() =>
      assertOutsideRepository("/repo/drop/avatars.json", "/repo/drop"),
    ).toThrow(/outside the repository/);
    expect(() =>
      assertOutsideRepository("/repo/drop/services/api/x.json", "/repo/drop"),
    ).toThrow(/outside the repository/);
    expect(() => assertOutsideRepository("/repo/drop", "/repo/drop")).toThrow(
      /outside the repository/,
    );
    expect(() =>
      assertOutsideRepository("/home/operator/avatars.json", "/repo/drop"),
    ).not.toThrow();
    expect(() =>
      assertOutsideRepository("/repo/drop-avatars.json", "/repo/drop"),
    ).not.toThrow();
  });
});
