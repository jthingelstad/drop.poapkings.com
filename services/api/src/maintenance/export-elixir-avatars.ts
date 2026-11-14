import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { paginateScan } from "@aws-sdk/lib-dynamodb";
import { favoriteCard } from "../cards.js";
import { client } from "../dynamo.js";

// Export Drop's profile images for Elixir's one-time import (2026-11-14).
//
// Drop's profile image is the profile's `favoriteCardId` (the Player Card),
// drawn as a CSS crop of the card's base art. That method has moved into
// Elixir, which keeps one card per account (`account.avatar_card_id`) and
// imports Drop's choices once, never over a choice made in Elixir. This
// script lists `{ elixirAccountId, favoriteCardId }` for every Drop profile
// that has both, for that import.
//
// Read only: one Scan of the base table's PLAYER#/PROFILE rows, projecting
// the two fields and the key. It writes nothing to DynamoDB and takes no
// production lock. It requires the cloud-engineer identity (account
// 999153317627, ProjectsCloudEngineer/projects-cloud-engineer) before any
// read.
//
// The ids are the same on both sides: Drop's catalog is Clash Royale's card
// ids (26000000 Knight, 28000000 Fireball, ...), and Elixir's
// `avatar_card_id` is its `card.card_id`, the same Clash Royale id. A card
// Drop's own catalog does not hold is left out and counted; Elixir checks
// its catalog again when it imports.
//
// The file holds account ids and card ids only: no address, name, player
// tag, Drop sub or player id. It is written where the operator names
// (--out), never inside the repository (which is public), with mode 0600,
// and an existing file is never overwritten. Standard output is counts only.

export const EXPECTED_ACCOUNT = "999153317627";
const EXPECTED_ROLE_SESSION =
  "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AvatarExportArgs {
  out: string;
  tableName: string;
}

export interface AvatarProfileRow {
  elixirAccountId?: unknown;
  linkAccountId?: unknown;
  favoriteCardId?: unknown;
}

export interface AvatarExportEntry {
  elixirAccountId: string;
  favoriteCardId: number;
}

export type AvatarExportSkip =
  | "no_elixir_account"
  | "no_card"
  | "card_not_in_catalog"
  | "link_names_other_account"
  | "account_on_two_profiles";

export interface AvatarExportPlan {
  avatars: AvatarExportEntry[];
  skipped: Record<AvatarExportSkip, number>;
}

export function parseAvatarExportArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): AvatarExportArgs {
  let out: string | undefined;
  let tableName = env.DROP_TABLE_NAME || env.TABLE_NAME || "elixir-drop";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "--table") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value`);
      if (argument === "--out") out = value;
      else tableName = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!out) throw new Error("--out is required: a path outside the repository");
  // npm runs a workspace script from the workspace directory; a relative
  // path means the directory the operator typed the command in.
  return { out: resolve(env.INIT_CWD || process.cwd(), out), tableName };
}

/** True for the cloud-engineer session in Jamie's account, and nothing else:
 *  not the jamie profile, not a deploy role, not a user key. */
export function isCloudEngineerIdentity(identity: {
  Account?: string;
  Arn?: string;
}): boolean {
  return (
    identity.Account === EXPECTED_ACCOUNT &&
    typeof identity.Arn === "string" &&
    identity.Arn.startsWith(`arn:aws:sts::${EXPECTED_ACCOUNT}:`) &&
    identity.Arn.includes(EXPECTED_ROLE_SESSION)
  );
}

/** Refuse an output path inside the repository: the repository is public,
 *  and a list of account ids does not belong in it, ignored or not. */
export function assertOutsideRepository(out: string, repositoryRoot: string) {
  const inside = relative(repositoryRoot, out);
  if (!inside || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new Error(
      "--out must be outside the repository; name a path such as ~/drop-avatars.json",
    );
}

export function planAvatarExport(
  profiles: Iterable<AvatarProfileRow>,
): AvatarExportPlan {
  const skipped: Record<AvatarExportSkip, number> = {
    no_elixir_account: 0,
    no_card: 0,
    card_not_in_catalog: 0,
    link_names_other_account: 0,
    account_on_two_profiles: 0,
  };
  const byAccount = new Map<string, AvatarExportEntry[]>();
  for (const profile of profiles) {
    const accountId =
      typeof profile.elixirAccountId === "string" &&
      UUID.test(profile.elixirAccountId)
        ? profile.elixirAccountId.toLowerCase()
        : undefined;
    if (!accountId) {
      skipped.no_elixir_account += 1;
      continue;
    }
    if (
      typeof profile.linkAccountId === "string" &&
      profile.linkAccountId.toLowerCase() !== accountId
    ) {
      skipped.link_names_other_account += 1;
      continue;
    }
    if (
      profile.favoriteCardId === undefined ||
      profile.favoriteCardId === null
    ) {
      skipped.no_card += 1;
      continue;
    }
    const card = favoriteCard(profile.favoriteCardId);
    if (!card) {
      skipped.card_not_in_catalog += 1;
      continue;
    }
    const entries = byAccount.get(accountId) ?? [];
    entries.push({ elixirAccountId: accountId, favoriteCardId: card.id });
    byAccount.set(accountId, entries);
  }
  const avatars: AvatarExportEntry[] = [];
  for (const entries of byAccount.values()) {
    // One Elixir account opens one Drop account, so two rows for one
    // account is a defect to look at, not a choice to guess between.
    const [only, ...others] = entries;
    if (only && others.length === 0) avatars.push(only);
    else skipped.account_on_two_profiles += entries.length;
  }
  avatars.sort((left, right) =>
    left.elixirAccountId.localeCompare(right.elixirAccountId),
  );
  return { avatars, skipped };
}

export function avatarExportDocument(
  plan: AvatarExportPlan,
  generatedAt: Date,
) {
  return {
    kind: "drop-profile-images",
    version: 1,
    generatedAt: generatedAt.toISOString(),
    cardIds: "clash-royale",
    count: plan.avatars.length,
    avatars: plan.avatars,
  };
}

async function* scanProfiles(tableName: string) {
  for await (const page of paginateScan(
    { client },
    {
      TableName: tableName,
      FilterExpression: "sk = :profile AND begins_with(pk, :player)",
      ExpressionAttributeValues: {
        ":profile": "PROFILE",
        ":player": "PLAYER#",
      },
      ExpressionAttributeNames: {
        "#account": "elixirAccountId",
        "#card": "favoriteCardId",
        "#elixir": "elixir",
      },
      ProjectionExpression: "pk, sk, #account, #card, #elixir.accountId",
      ConsistentRead: true,
    },
  )) {
    for (const item of page.Items ?? []) {
      yield {
        elixirAccountId: item.elixirAccountId,
        favoriteCardId: item.favoriteCardId,
        linkAccountId: (item.elixir as { accountId?: unknown } | undefined)
          ?.accountId,
      } satisfies AvatarProfileRow;
    }
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseAvatarExportArgs(argv);
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  assertOutsideRepository(args.out, repositoryRoot);
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the export");
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!isCloudEngineerIdentity(identity))
    throw new Error(
      "The profile image export requires the cloud-engineer profile (ProjectsCloudEngineer in 999153317627)",
    );

  const profiles: AvatarProfileRow[] = [];
  for await (const profile of scanProfiles(args.tableName))
    profiles.push(profile);
  const plan = planAvatarExport(profiles);
  await writeFile(
    args.out,
    `${JSON.stringify(avatarExportDocument(plan, new Date()), null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "written",
        table: args.tableName,
        profiles: profiles.length,
        exported: plan.avatars.length,
        skipped: plan.skipped,
      },
      null,
      2,
    )}\n`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Profile image export failed"}\n`,
    );
    process.exitCode = 1;
  });
}
