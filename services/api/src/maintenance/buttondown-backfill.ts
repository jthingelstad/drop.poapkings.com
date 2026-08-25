import {
  buttondownPlayerMetadata,
  buttondownSubscriberMetadataBody,
} from "../buttondown.js";
import type { CrProfileSnapshot, PlayerProfile } from "../types.js";

export interface ButtondownBackfillArgs {
  apply: boolean;
  envFile?: string;
  tableName: string;
}

export type ButtondownBackfillProfile = Pick<
  PlayerProfile,
  "email" | "playerId" | "playerTag" | "totalGames"
>;

export type ButtondownBackfillSnapshot = Pick<
  CrProfileSnapshot,
  "status" | "clan"
>;

export function parseButtondownBackfillArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ButtondownBackfillArgs {
  let apply = false;
  let envFile: string | undefined;
  let tableName = env.DROP_TABLE_NAME || env.TABLE_NAME || "elixir-drop";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--env-file" || argument === "--table") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${argument} requires a value`);
      if (argument === "--env-file") envFile = value;
      else tableName = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!tableName || tableName.startsWith("--"))
    throw new Error("--table requires a table name");
  return { apply, envFile, tableName };
}

export function desiredButtondownBackfillMetadata(
  profile: ButtondownBackfillProfile,
  appUrl: string,
  snapshot?: ButtondownBackfillSnapshot,
) {
  return buttondownSubscriberMetadataBody(
    buttondownPlayerMetadata(profile, appUrl, snapshot),
  );
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function managedButtondownMetadataMatches(
  current: unknown,
  desired: Record<string, unknown>,
): boolean {
  const existing = metadataRecord(current);
  return Object.entries(desired).every(([key, value]) =>
    Object.is(existing[key], value),
  );
}

export function mergeButtondownBackfillMetadata(
  current: unknown,
  desired: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (managedButtondownMetadataMatches(current, desired)) return undefined;
  return { ...metadataRecord(current), ...desired };
}
