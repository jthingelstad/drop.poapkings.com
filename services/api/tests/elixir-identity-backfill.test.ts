import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseElixirAccounts,
  parseElixirIdentityBackfillArgs,
  parsePairings,
  planElixirIdentityBackfill,
  subEmailHashHex,
  type BackfillProfile,
  type ElixirAccountRow,
} from "../src/maintenance/backfill-elixir-identity.js";
import { emailSubject, normalizeEmail } from "../src/validation.js";

const hex = (email: string) =>
  createHash("sha256").update(email).digest("hex").slice(0, 10);

const ACCT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACCT_C = "cccccccc-0000-4000-8000-000000000003";

function person(
  accountId: string,
  email: string,
  extra: Partial<ElixirAccountRow> = {},
): ElixirAccountRow {
  return {
    account_id: accountId,
    kind: "person",
    status: "approved",
    email_hash: hex(email),
    ...extra,
  };
}

function drop(
  email: string,
  playerId: string,
  extra: Partial<BackfillProfile> = {},
): BackfillProfile {
  return { sub: emailSubject(email), playerId, ...extra };
}

describe("Elixir identity backfill planning", () => {
  it("Drop's sub and Elixir's email hash are the same digest", () => {
    expect(
      subEmailHashHex(emailSubject(normalizeEmail(" A@Example.com "))),
    ).toBe(createHash("sha256").update("a@example.com").digest("hex"));
  });

  it("resolves same-address accounts by email hash and a different-address one by explicit pairing", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000");
    const v = drop(
      "v-drop@example.com",
      "4444abcd-0000-4000-8000-000000000000",
    );
    const { plans, skipped } = planElixirIdentityBackfill({
      profiles: [a, v],
      accounts: [
        person(ACCT_A, "a@example.com"),
        person(ACCT_B, "v-elixir@example.com"),
      ],
      pointers: new Map(),
      pairings: [{ playerIdPrefix: "4444abcd", accountId: "bbbbbbbb" }],
    });
    expect(plans).toEqual([
      {
        sub: a.sub,
        accountId: ACCT_A,
        via: "email_hash",
        alreadyCurrent: false,
      },
      { sub: v.sub, accountId: ACCT_B, via: "explicit", alreadyCurrent: false },
    ]);
    expect(Object.values(skipped).every((count) => count === 0)).toBe(true);
  });

  it("is idempotent: a pointer to the same account and a bound profile are already current", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000", {
      elixirAccountId: ACCT_A,
    });
    const { plans } = planElixirIdentityBackfill({
      profiles: [a],
      accounts: [person(ACCT_A, "a@example.com")],
      pointers: new Map([[ACCT_A, a.sub]]),
    });
    expect(plans).toEqual([
      {
        sub: a.sub,
        accountId: ACCT_A,
        via: "email_hash",
        alreadyCurrent: true,
      },
    ]);
  });

  it("reports, never overwrites, a pointer that names another Drop account", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000");
    const { plans, skipped } = planElixirIdentityBackfill({
      profiles: [a],
      accounts: [person(ACCT_A, "a@example.com")],
      pointers: new Map([[ACCT_A, "someone-else"]]),
    });
    expect(plans).toEqual([]);
    expect(skipped.pointer_names_other_profile).toBe(1);
  });

  it("leaves a profile bound elsewhere, or connected to a different account, alone", () => {
    const bound = drop(
      "a@example.com",
      "11111111-0000-4000-8000-000000000000",
      {
        elixirAccountId: ACCT_C,
      },
    );
    const linked = drop(
      "b@example.com",
      "22222222-0000-4000-8000-000000000000",
      {
        linkAccountId: ACCT_C,
      },
    );
    const { plans, skipped } = planElixirIdentityBackfill({
      profiles: [bound, linked],
      accounts: [
        person(ACCT_A, "a@example.com"),
        person(ACCT_B, "b@example.com"),
        person(ACCT_C, "c@example.com"),
      ],
      pointers: new Map(),
    });
    expect(plans).toEqual([]);
    expect(skipped.bound_to_other_account).toBe(1);
    expect(skipped.existing_link_differs).toBe(1);
  });

  it("uses a connection the profile already holds when no address matches", () => {
    const a = drop("old@example.com", "11111111-0000-4000-8000-000000000000", {
      linkAccountId: ACCT_A,
    });
    const { plans } = planElixirIdentityBackfill({
      profiles: [a],
      accounts: [person(ACCT_A, "new@example.com")],
      pointers: new Map(),
    });
    expect(plans[0]).toMatchObject({ accountId: ACCT_A, via: "existing_link" });
  });

  it("only an approved person is a target; unmatched and ambiguous profiles are counted", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000");
    const b = drop("b@example.com", "22222222-0000-4000-8000-000000000000");
    const c = drop("c@example.com", "33333333-0000-4000-8000-000000000000");
    const { plans, skipped } = planElixirIdentityBackfill({
      profiles: [a, b, c],
      accounts: [
        person(ACCT_A, "a@example.com", { kind: "agent" }),
        person(ACCT_B, "b@example.com", { status: "disabled" }),
        person(ACCT_C, "c@example.com"),
        person("dddddddd-0000-4000-8000-000000000004", "c@example.com"),
      ],
      pointers: new Map(),
    });
    expect(plans).toEqual([]);
    expect(skipped.unmatched).toBe(2);
    expect(skipped.ambiguous_email_hash).toBe(1);
  });

  it("writes neither profile when two resolve to the same Elixir account", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000");
    const v = drop("v@example.com", "4444abcd-0000-4000-8000-000000000000");
    const { plans, skipped } = planElixirIdentityBackfill({
      profiles: [a, v],
      accounts: [person(ACCT_A, "a@example.com")],
      pointers: new Map(),
      pairings: [{ playerIdPrefix: "4444abcd", accountId: ACCT_A }],
    });
    expect(plans).toEqual([]);
    expect(skipped.account_resolves_twice).toBe(2);
  });

  it("refuses a pairing that names no single Drop account or Elixir person", () => {
    const a = drop("a@example.com", "11111111-0000-4000-8000-000000000000");
    const accounts = [person(ACCT_A, "a@example.com")];
    expect(() =>
      planElixirIdentityBackfill({
        profiles: [a],
        accounts,
        pointers: new Map(),
        pairings: [{ playerIdPrefix: "99999999", accountId: "aaaaaaaa" }],
      }),
    ).toThrow("exactly one Drop account");
    expect(() =>
      planElixirIdentityBackfill({
        profiles: [a],
        accounts,
        pointers: new Map(),
        pairings: [{ playerIdPrefix: "11111111", accountId: "eeeeeeee" }],
      }),
    ).toThrow("exactly one Elixir person");
  });

  it("parses its arguments and input files strictly", () => {
    expect(
      parseElixirIdentityBackfillArgs(["--accounts", "a.json"], {}),
    ).toEqual({
      apply: false,
      accountsFile: "a.json",
      mapFile: undefined,
      tableName: "elixir-drop",
    });
    expect(
      parseElixirIdentityBackfillArgs(
        ["--accounts", "a.json", "--map", "m.json", "--table", "t", "--apply"],
        {},
      ),
    ).toEqual({
      apply: true,
      accountsFile: "a.json",
      mapFile: "m.json",
      tableName: "t",
    });
    expect(() => parseElixirIdentityBackfillArgs([], {})).toThrow(
      "--accounts is required",
    );
    expect(() => parseElixirIdentityBackfillArgs(["--accounts"], {})).toThrow(
      "requires a value",
    );
    expect(() =>
      parseElixirIdentityBackfillArgs(["--accounts", "a", "--force"], {}),
    ).toThrow("Unknown argument");

    expect(
      parseElixirAccounts({ accounts: [person(ACCT_A, "a@example.com")] }),
    ).toHaveLength(1);
    expect(
      parseElixirAccounts({
        accounts: [{ ...person(ACCT_A, "a@example.com"), email_hash: null }],
      })[0]?.email_hash,
    ).toBeNull();
    expect(() => parseElixirAccounts({})).toThrow("no accounts array");
    expect(() =>
      parseElixirAccounts({ accounts: [{ account_id: "x" }] }),
    ).toThrow("malformed");

    expect(
      parsePairings([{ playerIdPrefix: "4444ABCD", accountId: "BBBBBBBB" }]),
    ).toEqual([{ playerIdPrefix: "4444abcd", accountId: "bbbbbbbb" }]);
    expect(() => parsePairings({})).toThrow("not an array");
    expect(() => parsePairings([{ playerIdPrefix: "x" }])).toThrow("malformed");
  });
});
