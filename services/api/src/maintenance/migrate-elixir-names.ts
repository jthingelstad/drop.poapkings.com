import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { paginateScan } from "@aws-sdk/lib-dynamodb";
import { client } from "../dynamo.js";
import { primaryPlayer, tidyGameName } from "../elixir-identity.js";
import { Repository } from "../repository.js";
import type { ElixirLink } from "../types.js";
import { isCloudEngineerIdentity } from "./export-elixir-avatars.js";

// Retire Drop's made-up names once (2026-11-14). From this change a signed-in
// player shows the Clash Royale game name of their Elixir account's primary
// player, written at each sign-in. This sets it now for the profiles no
// sign-in has reached yet, from the players their last Elixir sign-in stored
// (`elixir.candidates`), so a made-up name does not wait for its owner to
// come back:
//
// - a verified primary player with a name: that name;
// - otherwise (no Elixir connection, an unverified or missing primary): no
//   name, and the boards show "Elixir Player" until the person signs in.
//
// The picture (`favoriteCardId`) is not touched: Elixir imports Drop's
// pictures, and the next sign-in brings whatever the person has there. The
// made-up name and card are kept once in `legacyIdentity`, so this can be
// undone. A profile a sign-in reaches between the scan and the write is left
// alone (the write is conditional).
//
// Dry run by default; --apply writes, holding Drop's production lock (see
// services/api/README.md). Output is counts only: no name, address, tag or id.

export type NameMigrationOutcome =
  | "primary_name"
  | "no_connection"
  | "primary_unverified"
  | "no_primary"
  | "already_from_elixir";

export interface NameMigrationRow {
  sub: string;
  publicName?: string;
  favoriteCardId?: number;
  identityFromElixirAt?: string;
  elixir?: Pick<ElixirLink, "candidates">;
}

export interface NameMigrationPlan {
  sub: string;
  primaryName?: string;
  before: Pick<NameMigrationRow, "publicName" | "favoriteCardId">;
}

export function planNameMigration(rows: Iterable<NameMigrationRow>): {
  plans: NameMigrationPlan[];
  counts: Record<NameMigrationOutcome, number>;
} {
  const counts: Record<NameMigrationOutcome, number> = {
    primary_name: 0,
    no_connection: 0,
    primary_unverified: 0,
    no_primary: 0,
    already_from_elixir: 0,
  };
  const plans: NameMigrationPlan[] = [];
  for (const row of rows) {
    if (row.identityFromElixirAt) {
      counts.already_from_elixir += 1;
      continue;
    }
    const candidates = Array.isArray(row.elixir?.candidates)
      ? row.elixir.candidates
      : undefined;
    const primary = candidates ? primaryPlayer(candidates) : undefined;
    const name = primary?.verified ? tidyGameName(primary.name) : undefined;
    if (name) counts.primary_name += 1;
    else if (!candidates) counts.no_connection += 1;
    else if (!primary) counts.no_primary += 1;
    else counts.primary_unverified += 1;
    plans.push({
      sub: row.sub,
      ...(name ? { primaryName: name } : {}),
      before: {
        ...(row.publicName ? { publicName: row.publicName } : {}),
        ...(row.favoriteCardId !== undefined
          ? { favoriteCardId: row.favoriteCardId }
          : {}),
      },
    });
  }
  return { plans, counts };
}

export function parseNameMigrationArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  let apply = false;
  let tableName = env.DROP_TABLE_NAME || env.TABLE_NAME || "elixir-drop";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") apply = true;
    else if (argument === "--table" && argv[index + 1])
      tableName = argv[++index]!;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { apply, tableName };
}

async function* scanProfiles(
  tableName: string,
): AsyncGenerator<NameMigrationRow> {
  for await (const page of paginateScan(
    { client },
    {
      TableName: tableName,
      FilterExpression: "sk = :profile AND begins_with(pk, :player)",
      ExpressionAttributeValues: {
        ":profile": "PROFILE",
        ":player": "PLAYER#",
      },
      ProjectionExpression:
        "pk, publicName, favoriteCardId, identityFromElixirAt, elixir.candidates",
      ConsistentRead: true,
    },
  )) {
    for (const item of page.Items ?? [])
      yield {
        sub: String(item.pk).slice("PLAYER#".length),
        ...(typeof item.publicName === "string"
          ? { publicName: item.publicName }
          : {}),
        ...(typeof item.favoriteCardId === "number"
          ? { favoriteCardId: item.favoriteCardId }
          : {}),
        ...(typeof item.identityFromElixirAt === "string"
          ? { identityFromElixirAt: item.identityFromElixirAt }
          : {}),
        ...(item.elixir
          ? { elixir: item.elixir as NameMigrationRow["elixir"] }
          : {}),
      };
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseNameMigrationArgs(argv);
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the migration");
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!isCloudEngineerIdentity(identity))
    throw new Error(
      "The name migration requires the cloud-engineer profile (ProjectsCloudEngineer in 999153317627)",
    );
  const rows: NameMigrationRow[] = [];
  for await (const row of scanProfiles(args.tableName)) rows.push(row);
  const { plans, counts } = planNameMigration(rows);
  const summary = {
    status: args.apply ? "applied" : "dry_run",
    table: args.tableName,
    profiles: rows.length,
    counts,
    written: 0,
    changedMeanwhile: 0,
  };
  if (args.apply) {
    const repository = new Repository(args.tableName);
    for (const plan of plans) {
      try {
        await repository.applyElixirIdentity(
          plan.sub,
          plan.primaryName ? { primaryName: plan.primaryName } : {},
          plan.before,
          { firstTimeOnly: true },
        );
        summary.written += 1;
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "ConditionalCheckFailedException"
        )
          summary.changedMeanwhile += 1;
        else throw error;
      }
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
