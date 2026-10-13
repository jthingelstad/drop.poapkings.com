import { readFile } from "node:fs/promises";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { paginateScan } from "@aws-sdk/lib-dynamodb";
import { client } from "../dynamo.js";
import { Repository } from "../repository.js";

// Backfill the Elixir identity pointer (ELIXIR#<accountId> -> Drop sub) for
// the Drop accounts that existed before Drop signed in only with Elixir.
//
// Dry run by default; --apply writes. Each write is the same transaction a
// sign-in uses (Repository.bindElixirAccount, without a link): the pointer
// and the profile's elixirAccountId together, conditionally, so a rerun is a
// no-op, a pointer to another account is reported and never overwritten, and
// a profile already bound elsewhere is left alone. The Elixir connection
// (ElixirLink, the verified mark) is NOT written: it needs the person's own
// Elixir players, which only their next sign-in reads.
//
// Inputs are files the operator keeps outside the repository (the repository
// is public): --accounts, Elixir's account list (`account_role` list op:
// account_id, kind, status and a ten-hex email_hash prefix), and an optional
// --map of explicit pairings for a person whose Elixir address differs from
// their Drop address: [{ "playerIdPrefix": "...", "accountId": "..." }].
// Output is counts only: no address, account id, sub or player id.

export interface ElixirAccountRow {
  account_id: string;
  kind: string;
  status: string;
  email_hash?: string | null;
}

export interface ExplicitPairing {
  playerIdPrefix: string;
  accountId: string;
}

export interface BackfillProfile {
  sub: string;
  playerId: string;
  elixirAccountId?: string;
  linkAccountId?: string;
}

export type BackfillSkip =
  | "unmatched"
  | "ambiguous_email_hash"
  | "existing_link_differs"
  | "bound_to_other_account"
  | "pointer_names_other_profile"
  | "account_resolves_twice";

export interface BackfillPlan {
  sub: string;
  accountId: string;
  via: "email_hash" | "explicit" | "existing_link";
  alreadyCurrent: boolean;
}

export interface BackfillPlanning {
  plans: BackfillPlan[];
  skipped: Record<BackfillSkip, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseElixirIdentityBackfillArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  let apply = false;
  let accountsFile: string | undefined;
  let mapFile: string | undefined;
  let tableName = env.DROP_TABLE_NAME || env.TABLE_NAME || "elixir-drop";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (
      argument === "--accounts" ||
      argument === "--map" ||
      argument === "--table"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value`);
      if (argument === "--accounts") accountsFile = value;
      else if (argument === "--map") mapFile = value;
      else tableName = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!accountsFile) throw new Error("--accounts is required");
  return { apply, accountsFile, mapFile, tableName };
}

// Elixir stores sha256(trimmed lowercase address) as hex; Drop keys an
// account by the same digest in base64url.
export function subEmailHashHex(sub: string): string {
  return Buffer.from(sub, "base64url").toString("hex");
}

export function parseElixirAccounts(raw: unknown): ElixirAccountRow[] {
  const accounts = (raw as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts))
    throw new Error("The Elixir account list has no accounts array");
  return accounts.map((row: unknown) => {
    const account = row as Record<string, unknown>;
    if (
      typeof account.account_id !== "string" ||
      !UUID.test(account.account_id) ||
      typeof account.kind !== "string" ||
      typeof account.status !== "string" ||
      (account.email_hash != null &&
        (typeof account.email_hash !== "string" ||
          !/^[0-9a-f]{8,64}$/.test(account.email_hash)))
    )
      throw new Error("An Elixir account row is malformed");
    return {
      account_id: account.account_id,
      kind: account.kind,
      status: account.status,
      email_hash: account.email_hash as string | null | undefined,
    };
  });
}

export function parsePairings(raw: unknown): ExplicitPairing[] {
  if (!Array.isArray(raw)) throw new Error("The pairing file is not an array");
  return raw.map((row: unknown) => {
    const pairing = row as Record<string, unknown>;
    if (
      typeof pairing.playerIdPrefix !== "string" ||
      !/^[0-9a-f-]{8,36}$/i.test(pairing.playerIdPrefix) ||
      typeof pairing.accountId !== "string" ||
      !/^[0-9a-f-]{8,36}$/i.test(pairing.accountId)
    )
      throw new Error("A pairing is malformed");
    return {
      playerIdPrefix: pairing.playerIdPrefix.toLowerCase(),
      accountId: pairing.accountId.toLowerCase(),
    };
  });
}

function emptySkips(): Record<BackfillSkip, number> {
  return {
    unmatched: 0,
    ambiguous_email_hash: 0,
    existing_link_differs: 0,
    bound_to_other_account: 0,
    pointer_names_other_profile: 0,
    account_resolves_twice: 0,
  };
}

// Decide every profile's Elixir account, without I/O. Only an approved
// person account is ever a target. An explicit pairing wins; then the email
// hash; then an Elixir connection the profile already holds.
export function planElixirIdentityBackfill(input: {
  profiles: BackfillProfile[];
  accounts: ElixirAccountRow[];
  pointers: Map<string, string>;
  pairings?: ExplicitPairing[];
}): BackfillPlanning {
  const people = input.accounts.filter(
    (account) => account.kind === "person" && account.status === "approved",
  );
  const pairings = input.pairings ?? [];
  for (const pairing of pairings) {
    const profiles = input.profiles.filter((profile) =>
      profile.playerId.toLowerCase().startsWith(pairing.playerIdPrefix),
    );
    if (profiles.length !== 1)
      throw new Error("A pairing does not name exactly one Drop account");
    const accounts = people.filter((account) =>
      account.account_id.toLowerCase().startsWith(pairing.accountId),
    );
    if (accounts.length !== 1)
      throw new Error("A pairing does not name exactly one Elixir person");
  }

  const skipped = emptySkips();
  const candidates: BackfillPlan[] = [];
  for (const profile of input.profiles) {
    let accountId: string | undefined;
    let via: BackfillPlan["via"] | undefined;
    const pairing = pairings.find((candidate) =>
      profile.playerId.toLowerCase().startsWith(candidate.playerIdPrefix),
    );
    if (pairing) {
      accountId = people.find((account) =>
        account.account_id.toLowerCase().startsWith(pairing.accountId),
      )!.account_id;
      via = "explicit";
    } else {
      const hex = subEmailHashHex(profile.sub);
      const matches = people.filter(
        (account) => account.email_hash && hex.startsWith(account.email_hash),
      );
      if (matches.length > 1) {
        skipped.ambiguous_email_hash += 1;
        continue;
      }
      if (matches.length === 1) {
        accountId = matches[0]!.account_id;
        via = "email_hash";
      } else if (
        profile.linkAccountId &&
        people.some((account) => account.account_id === profile.linkAccountId)
      ) {
        accountId = profile.linkAccountId;
        via = "existing_link";
      }
    }
    if (!accountId || !via) {
      skipped.unmatched += 1;
      continue;
    }
    if (profile.linkAccountId && profile.linkAccountId !== accountId) {
      skipped.existing_link_differs += 1;
      continue;
    }
    if (profile.elixirAccountId && profile.elixirAccountId !== accountId) {
      skipped.bound_to_other_account += 1;
      continue;
    }
    const pointed = input.pointers.get(accountId);
    if (pointed !== undefined && pointed !== profile.sub) {
      skipped.pointer_names_other_profile += 1;
      continue;
    }
    candidates.push({
      sub: profile.sub,
      accountId,
      via,
      alreadyCurrent:
        pointed === profile.sub && profile.elixirAccountId === accountId,
    });
  }

  // One Elixir account binds one Drop account: if two profiles resolve to
  // the same account, neither is written.
  const perAccount = new Map<string, number>();
  for (const plan of candidates)
    perAccount.set(plan.accountId, (perAccount.get(plan.accountId) ?? 0) + 1);
  const plans = candidates.filter((plan) => {
    if (perAccount.get(plan.accountId) === 1) return true;
    skipped.account_resolves_twice += 1;
    return false;
  });
  return { plans, skipped };
}

async function scanDrop(tableName: string) {
  const profiles: BackfillProfile[] = [];
  const pointers = new Map<string, string>();
  for await (const page of paginateScan(
    { client },
    {
      TableName: tableName,
      FilterExpression:
        "(sk = :profile AND begins_with(pk, :player)) OR (sk = :drop AND begins_with(pk, :elixir))",
      ExpressionAttributeValues: {
        ":profile": "PROFILE",
        ":player": "PLAYER#",
        ":drop": "DROP",
        ":elixir": "ELIXIR#",
      },
      ProjectionExpression:
        "pk, sk, playerId, elixirAccountId, elixir, dropSub",
      ConsistentRead: true,
    },
  )) {
    for (const item of page.Items ?? []) {
      const pk = String(item.pk);
      if (pk.startsWith("ELIXIR#")) {
        if (typeof item.dropSub !== "string")
          throw new Error("An Elixir pointer has no Drop account");
        pointers.set(pk.slice("ELIXIR#".length), item.dropSub);
        continue;
      }
      if (typeof item.playerId !== "string")
        throw new Error("A player profile has no player id");
      const linkAccountId = (item.elixir as { accountId?: unknown } | undefined)
        ?.accountId;
      profiles.push({
        sub: pk.slice("PLAYER#".length),
        playerId: item.playerId,
        ...(typeof item.elixirAccountId === "string"
          ? { elixirAccountId: item.elixirAccountId }
          : {}),
        ...(typeof linkAccountId === "string" ? { linkAccountId } : {}),
      });
    }
  }
  return { profiles, pointers };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseElixirIdentityBackfillArgs(argv);
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the backfill");
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!(identity.Arn ?? "").includes(":assumed-role/ProjectsCloudEngineer/"))
    throw new Error(
      "The Elixir identity backfill requires ProjectsCloudEngineer",
    );

  const accounts = parseElixirAccounts(
    JSON.parse(await readFile(args.accountsFile, "utf8")),
  );
  const pairings = args.mapFile
    ? parsePairings(JSON.parse(await readFile(args.mapFile, "utf8")))
    : [];
  const { profiles, pointers } = await scanDrop(args.tableName);
  const { plans, skipped } = planElixirIdentityBackfill({
    profiles,
    accounts,
    pointers,
    pairings,
  });

  const via = { email_hash: 0, explicit: 0, existing_link: 0 };
  for (const plan of plans) via[plan.via] += 1;
  const summary = {
    status: args.apply ? "applied" : "dry_run",
    table: args.tableName,
    profiles: profiles.length,
    pointersBefore: pointers.size,
    resolved: plans.length,
    via,
    alreadyCurrent: plans.filter((plan) => plan.alreadyCurrent).length,
    toWrite: plans.filter((plan) => !plan.alreadyCurrent).length,
    skipped,
    bound: 0,
    refused: {} as Record<string, number>,
  };
  if (args.apply) {
    const repository = new Repository(args.tableName);
    for (const plan of plans) {
      if (plan.alreadyCurrent) continue;
      const outcome = await repository.bindElixirAccount(
        plan.sub,
        plan.accountId,
      );
      if (outcome === "bound") summary.bound += 1;
      else summary.refused[outcome] = (summary.refused[outcome] ?? 0) + 1;
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (Object.keys(summary.refused).length) process.exitCode = 1;
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Elixir identity backfill failed"}\n`,
    );
    process.exitCode = 1;
  });
}
