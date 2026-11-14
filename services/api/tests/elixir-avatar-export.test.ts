import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOutsideRepository,
  canonicalOutputCheck,
  avatarImportBody,
  MAX_PAIRS,
  parseAvatarExportArgs,
  planAvatarExport,
} from "../src/maintenance/export-elixir-avatars.js";
import { isCloudEngineerIdentity } from "../src/maintenance/cloud-engineer.js";

const ACCT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACCT_C = "cccccccc-0000-4000-8000-000000000003";
const KNIGHT = 26000000;
const FIREBALL = 28000000;

describe("profile image export", () => {
  it("lists account id and card id for every profile that has both, and nothing else", () => {
    const { pairs, skipped } = planAvatarExport([
      { elixirAccountId: ACCT_B, favoriteCardId: FIREBALL },
      { elixirAccountId: ACCT_A, favoriteCardId: KNIGHT },
      { favoriteCardId: KNIGHT },
      { elixirAccountId: ACCT_C },
      { elixirAccountId: "not-a-uuid", favoriteCardId: KNIGHT },
    ]);
    expect(pairs).toEqual([
      { account_id: ACCT_A, card_id: KNIGHT },
      { account_id: ACCT_B, card_id: FIREBALL },
    ]);
    expect(skipped).toMatchObject({ no_elixir_account: 2, no_card: 1 });
    for (const entry of pairs)
      expect(Object.keys(entry).sort()).toEqual(["account_id", "card_id"]);
  });

  it("leaves out a card Drop's catalog does not hold, or a non-integer", () => {
    const { pairs, skipped } = planAvatarExport([
      { elixirAccountId: ACCT_A, favoriteCardId: 159000000 },
      { elixirAccountId: ACCT_B, favoriteCardId: "26000000" },
      { elixirAccountId: ACCT_C, favoriteCardId: 26000000.5 },
    ]);
    expect(pairs).toEqual([]);
    expect(skipped.card_not_in_catalog).toBe(3);
  });

  it("refuses to guess when one account appears on two profiles or the link disagrees", () => {
    const { pairs, skipped } = planAvatarExport([
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
    expect(pairs).toEqual([{ account_id: ACCT_C, card_id: KNIGHT }]);
    expect(skipped.account_on_two_profiles).toBe(2);
    expect(skipped.link_names_other_account).toBe(1);
  });

  it("writes exactly the body of Elixir's avatar_import op, ids only", () => {
    const skipped = {
      no_elixir_account: 0,
      no_card: 0,
      card_not_in_catalog: 0,
      link_names_other_account: 0,
      account_on_two_profiles: 0,
    };
    const body = avatarImportBody({
      pairs: [{ account_id: ACCT_A, card_id: KNIGHT }],
      skipped,
    });
    // Nothing beside `pairs`: the op refuses unknown keys, and with no
    // `apply` key it is a dry run.
    expect(body).toEqual({
      avatar_import: { pairs: [{ account_id: ACCT_A, card_id: KNIGHT }] },
    });
    expect(JSON.stringify(body)).not.toMatch(/@|#|PLAYER|sub|apply/);
  });

  it("refuses an empty import and one larger than the op takes", () => {
    const skipped = {
      no_elixir_account: 0,
      no_card: 0,
      card_not_in_catalog: 0,
      link_names_other_account: 0,
      account_on_two_profiles: 0,
    };
    expect(() => avatarImportBody({ pairs: [], skipped })).toThrow(
      /No profile/,
    );
    const pairs = Array.from({ length: MAX_PAIRS + 1 }, (_, index) => ({
      account_id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
      card_id: KNIGHT,
    }));
    expect(MAX_PAIRS).toBe(5000);
    expect(() => avatarImportBody({ pairs, skipped })).toThrow(/5000/);
    expect(() =>
      avatarImportBody({ pairs: pairs.slice(0, MAX_PAIRS), skipped }),
    ).not.toThrow();
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
    expect(() =>
      assertOutsideRepository("/repo/drop/..exports/x.json", "/repo/drop"),
    ).toThrow(/outside the repository/);
    expect(() =>
      assertOutsideRepository("/repo/x.json", "/repo/drop"),
    ).not.toThrow();
  });

  it("follows directory links before deciding a path is outside", async () => {
    const base = await mkdtemp(join(tmpdir(), "drop-avatar-export-"));
    try {
      const repository = join(base, "repo");
      const outside = join(base, "outside");
      await mkdir(join(repository, "exports"), { recursive: true });
      await mkdir(outside);
      await symlink(join(repository, "exports"), join(outside, "into-repo"));

      await expect(
        canonicalOutputCheck(join(outside, "into-repo", "a.json"), repository),
      ).rejects.toThrow(/outside the repository/);
      await expect(
        canonicalOutputCheck(join(outside, "a.json"), repository),
      ).resolves.toMatch(/a\.json$/);
      await expect(
        canonicalOutputCheck(join(outside, "missing", "a.json"), repository),
      ).rejects.toThrow(/must already exist/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
