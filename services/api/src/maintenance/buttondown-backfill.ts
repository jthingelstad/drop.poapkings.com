import {
  buttondownPlayerMetadata,
  buttondownSubscriberMetadataBody,
} from "../buttondown.js";
import { crSeasonIdFor } from "../seasons.js";
import type { CrProfileSnapshot, PlayerProfile } from "../types.js";

export interface ButtondownBackfillArgs {
  apply: boolean;
  envFile?: string;
  tableName: string;
}

export type ButtondownBackfillProfile = Pick<
  PlayerProfile,
  "email" | "playerId" | "playerTag" | "totalGames" | "lastSeasonPlayed"
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

export function reconcileButtondownLastSeasonPlayed(
  profile: Pick<PlayerProfile, "totalGames" | "lastSeasonPlayed">,
  latestRunSeasonId: string | undefined,
  clock: { leaderboardSeasonId: string; crSeasonId: number } | undefined,
):
  | { resolved: false }
  | { resolved: true; lastSeasonPlayed?: number; profileUpdate: boolean } {
  if (profile.totalGames === 0)
    return profile.lastSeasonPlayed === undefined
      ? { resolved: true, profileUpdate: false }
      : { resolved: false };
  const lastSeasonPlayed = latestRunSeasonId
    ? crSeasonIdFor(latestRunSeasonId, clock)
    : undefined;
  if (
    !lastSeasonPlayed ||
    (profile.lastSeasonPlayed !== undefined &&
      profile.lastSeasonPlayed > lastSeasonPlayed)
  )
    return { resolved: false };
  return {
    resolved: true,
    lastSeasonPlayed,
    profileUpdate: profile.lastSeasonPlayed !== lastSeasonPlayed,
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

const RETIRED_METADATA_KEYS = ["total_games"] as const;
const TAG_METADATA_KEYS = [
  "player_tag",
  "drop_player_tag",
  "clan_tag",
] as const;

function normalizedMetadataTag(value: unknown): unknown {
  return typeof value === "string" && value.startsWith("#")
    ? value.slice(1)
    : value;
}

export function managedButtondownMetadataMatches(
  current: unknown,
  desired: Record<string, unknown>,
): boolean {
  const existing = metadataRecord(current);
  if (RETIRED_METADATA_KEYS.some((key) => Object.hasOwn(existing, key)))
    return false;
  if (
    !Object.hasOwn(desired, "last_season_played") &&
    Object.hasOwn(existing, "last_season_played")
  )
    return false;
  if (
    TAG_METADATA_KEYS.some(
      (key) => !Object.is(existing[key], normalizedMetadataTag(existing[key])),
    )
  )
    return false;
  return Object.entries(desired).every(([key, value]) =>
    Object.is(existing[key], value),
  );
}

export function mergeButtondownBackfillMetadata(
  current: unknown,
  desired: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (managedButtondownMetadataMatches(current, desired)) return undefined;
  const merged = metadataRecord(current);
  for (const key of RETIRED_METADATA_KEYS) delete merged[key];
  if (!Object.hasOwn(desired, "last_season_played"))
    delete merged.last_season_played;
  for (const key of TAG_METADATA_KEYS)
    merged[key] = normalizedMetadataTag(merged[key]);
  return { ...merged, ...desired };
}
