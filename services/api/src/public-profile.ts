import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { client, profileKey } from "./dynamo.js";
import { levelForGames } from "./progression.js";
import type { PlayerProfile, PublicProfile } from "./types.js";

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
  // BatchGet is allowed to return unprocessed keys under throttling; without
  // the retry, real players render as the placeholder profile.
  let keys: Array<Record<string, unknown>> = subs.map((sub) => profileKey(sub));
  for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
    if (attempt > 0)
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    const profileResult = await client.send(
      new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: keys,
            ProjectionExpression:
              "#sub, playerId, publicName, favoriteCardId, playerTag, totalGames, xp",
            ExpressionAttributeNames: {
              "#sub": "sub",
            },
          },
        },
      }),
    );
    for (const item of profileResult.Responses?.[tableName] ?? []) {
      const profile = item as PlayerProfile;
      profiles.set(profile.sub, publicProfile(profile));
    }
    keys = (profileResult.UnprocessedKeys?.[tableName]?.Keys ?? []) as Array<
      Record<string, unknown>
    >;
  }
  return profiles;
}
