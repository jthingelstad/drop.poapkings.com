import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { paginateScan } from "@aws-sdk/lib-dynamodb";
import { client } from "../dynamo.js";
import {
  type ElixirIdentity,
  primaryPlayer,
  tidyGameName,
} from "../elixir-identity.js";
import { Repository } from "../repository.js";
import type { ElixirLink } from "../types.js";
import { isCloudEngineerIdentity } from "./export-elixir-avatars.js";

// Retire Drop's made-up identity once (2026-11-14). From this change a
// signed-in player shows the Clash Royale game name of their Elixir
// account's primary player (verified or not; the verified mark is separate),
// the picture they set in Elixir, and the primary player's tag, all written
// at each sign-in. This brings every profile no sign-in has reached yet to
// the same rules now, so nothing Drop made up waits for its owner to come
// back:
//
// - the name: the primary player's name from their last Elixir sign-in
//   (`elixir.candidates`, which came from Elixir); with no connection, no
//   primary, or a name that tidies to nothing, no name, and Drop shows
//   "Elixir Player" until the person signs in;
// - the picture: cleared. Every picture on a profile not yet signed in since
//   this change was chosen in Drop; Elixir has imported them, so the next
//   sign-in brings back whatever the person has there;
// - the tag: kept only when it is the stored primary player's; any other
//   tag (one typed into Drop before 2026-11-12, or a former primary) is
//   cleared, with the verified mark that rides on it.
//
// What the profile had is kept once in `legacyIdentity`, so this can be
// undone. A profile a sign-in reaches between the scan and the write is left
// alone (the write is conditional).
//
// Dry run by default; --apply writes, holding Drop's production lock (see
// services/api/README.md). Output is counts only: no name, address, tag or id.

export type NameMigrationOutcome =
  | "primary_name"
  | "primary_unnamed"
  | "no_connection"
  | "no_primary"
  | "already_from_elixir";

export interface NameMigrationRow {
  sub: string;
  publicName?: string;
  favoriteCardId?: number;
  playerTag?: string;
  identityFromElixirAt?: string;
  elixir?: Pick<ElixirLink, "candidates">;
}

export interface NameMigrationPlan {
  sub: string;
  primaryName?: string;
  clearPlayerTag: boolean;
  before: Pick<NameMigrationRow, "publicName" | "favoriteCardId" | "playerTag">;
}

export interface NameMigrationCounts {
  outcomes: Record<NameMigrationOutcome, number>;
  picturesCleared: number;
  tagsCleared: number;
}

export function planNameMigration(rows: Iterable<NameMigrationRow>): {
  plans: NameMigrationPlan[];
  counts: NameMigrationCounts;
} {
  const outcomes: Record<NameMigrationOutcome, number> = {
    primary_name: 0,
    primary_unnamed: 0,
    no_connection: 0,
    no_primary: 0,
    already_from_elixir: 0,
  };
  let picturesCleared = 0;
  let tagsCleared = 0;
  const plans: NameMigrationPlan[] = [];
  for (const row of rows) {
    if (row.identityFromElixirAt) {
      outcomes.already_from_elixir += 1;
      continue;
    }
    const candidates = Array.isArray(row.elixir?.candidates)
      ? row.elixir.candidates
      : undefined;
    const primary = candidates ? primaryPlayer(candidates) : undefined;
    const name = primary ? tidyGameName(primary.name) : undefined;
    if (name) outcomes.primary_name += 1;
    else if (!candidates) outcomes.no_connection += 1;
    else if (!primary) outcomes.no_primary += 1;
    else outcomes.primary_unnamed += 1;
    const clearPlayerTag = Boolean(
      row.playerTag && row.playerTag !== primary?.playerTag,
    );
    if (clearPlayerTag) tagsCleared += 1;
    if (row.favoriteCardId !== undefined) picturesCleared += 1;
    plans.push({
      sub: row.sub,
      ...(name ? { primaryName: name } : {}),
      clearPlayerTag,
      before: {
        ...(row.publicName ? { publicName: row.publicName } : {}),
        ...(row.favoriteCardId !== undefined
          ? { favoriteCardId: row.favoriteCardId }
          : {}),
        ...(row.playerTag ? { playerTag: row.playerTag } : {}),
      },
    });
  }
  return { plans, counts: { outcomes, picturesCleared, tagsCleared } };
}

/** The write for one plan: the primary's name or none, no picture, and the
 *  tag cleared when it is not the primary's. Exported for the tests. */
export function migrationWrite(plan: NameMigrationPlan): {
  identity: ElixirIdentity;
  options: { firstTimeOnly: true; clearPlayerTag: boolean };
} {
  return {
    identity: {
      ...(plan.primaryName ? { primaryName: plan.primaryName } : {}),
      avatarCardId: null,
    },
    options: { firstTimeOnly: true, clearPlayerTag: plan.clearPlayerTag },
  };
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
        "pk, publicName, favoriteCardId, playerTag, identityFromElixirAt, elixir.candidates",
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
        ...(typeof item.playerTag === "string"
          ? { playerTag: item.playerTag }
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
        const { identity, options } = migrationWrite(plan);
        await repository.applyElixirIdentity(
          plan.sub,
          identity,
          plan.before,
          options,
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
