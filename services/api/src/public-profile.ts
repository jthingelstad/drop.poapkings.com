import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { client, profileKey } from "./dynamo.js";
import { levelForGames } from "./progression.js";
import type {
  CrProfileSnapshot,
  PlayerProfile,
  PublicProfile,
} from "./types.js";

const BATCH_GET_SIZE = 100;

async function batchGet(
  tableName: string,
  requestedKeys: Array<Record<string, unknown>>,
  projection?: {
    expression: string;
    names?: Record<string, string>;
  },
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  for (
    let offset = 0;
    offset < requestedKeys.length;
    offset += BATCH_GET_SIZE
  ) {
    let keys = requestedKeys.slice(offset, offset + BATCH_GET_SIZE);
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const result = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: keys,
              ...(projection
                ? {
                    ProjectionExpression: projection.expression,
                    ...(projection.names
                      ? { ExpressionAttributeNames: projection.names }
                      : {}),
                  }
                : {}),
            },
          },
        }),
      );
      items.push(
        ...((result.Responses?.[tableName] ?? []) as Array<
          Record<string, unknown>
        >),
      );
      keys = (result.UnprocessedKeys?.[tableName]?.Keys ?? []) as Array<
        Record<string, unknown>
      >;
    }
  }
  return items;
}

export type PublicProfileSource = Pick<
  PlayerProfile,
  | "playerId"
  | "publicName"
  | "favoriteCardId"
  | "playerTag"
  | "totalGames"
  | "xp"
>;

export function publicProfile(profile: PublicProfileSource): PublicProfile {
  const progress = levelForGames(profile.totalGames);
  return {
    id: profile.playerId,
    publicName: profile.publicName || "Elixir Player",
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    totalGames: profile.totalGames,
    xp: profile.xp ?? 0,
    ...progress,
  };
}

// The stand-in used when a row's owning profile could not be read: a board or
// feed entry still renders in rank order rather than disappearing.
export function placeholderPublicProfile(index: number): PublicProfile {
  return {
    id: `player-${index + 1}`,
    publicName: "Elixir Player",
    totalGames: 0,
    xp: 0,
    ...levelForGames(0),
  };
}

// Shared public-profile hydration for the season board, the all-time board, and
// the recent-activity feed.
export async function hydratePublicProfiles(
  tableName: string,
  subs: string[],
): Promise<Map<string, PublicProfile>> {
  const profiles = new Map<string, PublicProfile>();
  if (!subs.length) return profiles;
  // BatchGet is allowed to return unprocessed keys under throttling and has a
  // hard 100-key ceiling. Chunking here keeps the clan board's 200-row page
  // legal while retaining the existing retry behavior.
  const items = await batchGet(
    tableName,
    [...new Set(subs)].map((sub) => profileKey(sub)),
    {
      expression:
        "#sub, playerId, publicName, favoriteCardId, playerTag, totalGames, xp",
      names: { "#sub": "sub" },
    },
  );
  for (const item of items) {
    const profile = item as unknown as PlayerProfile;
    profiles.set(profile.sub, publicProfile(profile));
  }
  return profiles;
}

// Current clan membership is resolved from the latest stored CR snapshots.
// This is intentionally a storage-only read: only the bridge may call the
// Clash Royale API at runtime.
export async function hydrateCrProfiles(
  tableName: string,
  tags: string[],
): Promise<Map<string, CrProfileSnapshot>> {
  const snapshots = new Map<string, CrProfileSnapshot>();
  const items = await batchGet(
    tableName,
    [...new Set(tags)].map((tag) => ({
      pk: `CR_PLAYER#${tag}`,
      sk: "PROFILE",
    })),
  );
  for (const item of items) {
    const snapshot = item as unknown as CrProfileSnapshot;
    if (snapshot.tag) snapshots.set(snapshot.tag, snapshot);
  }
  return snapshots;
}
