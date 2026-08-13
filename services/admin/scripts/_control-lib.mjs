import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";

let cachedClient;

export function client() {
  if (cachedClient) return cachedClient;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) fail("no_aws_region", "Set AWS_REGION for Drop Control");
  cachedClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cachedClient;
}

export function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function fail(reason, detail) {
  print({ status: "error", reason, ...(detail ? { detail } : {}) });
  process.exit(1);
}

export function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) flags[value.slice(2)] = true;
    else {
      flags[value.slice(2)] = next;
      index += 1;
    }
  }
  return { flags, positional };
}

export async function scanProfiles(doc = client()) {
  const profiles = [];
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "sk = :profile AND begins_with(pk, :player)",
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":player": "PLAYER#",
        },
        ProjectionExpression:
          "pk, sk, playerId, email, publicName, favoriteCardId, playerTag, totalGames, xp, createdAt, updatedAt, lastLoginAt",
        Select: "SPECIFIC_ATTRIBUTES",
        ExclusiveStartKey: lastKey,
      }),
    );
    profiles.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return profiles;
}

export async function findProfile(doc, playerId) {
  const profiles = await scanProfiles(doc);
  return profiles.find((profile) => profile.playerId === playerId);
}

async function batchCrProfiles(doc, tags) {
  const snapshots = new Map();
  const unique = [...new Set(tags.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 100) {
    let keys = unique.slice(offset, offset + 100).map((tag) => ({
      pk: `CR_PLAYER#${tag}`,
      sk: "PROFILE",
    }));
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      const result = await doc.send(
        new BatchGetCommand({
          RequestItems: {
            [TABLE_NAME]: {
              Keys: keys,
              ProjectionExpression:
                "pk, sk, #tag, #status, #name, clan, accountAge, cards, fetchedAt, refreshRequestedAt, updatedAt",
              ExpressionAttributeNames: {
                "#tag": "tag",
                "#status": "status",
                "#name": "name",
              },
            },
          },
        }),
      );
      for (const snapshot of result.Responses?.[TABLE_NAME] ?? []) {
        if (typeof snapshot.tag === "string")
          snapshots.set(snapshot.tag, snapshot);
      }
      keys = result.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
    }
    if (keys.length)
      throw new Error(
        `Account snapshots unavailable for ${keys.length} tag(s)`,
      );
  }
  return snapshots;
}

function cleanProfile(profile) {
  return {
    playerId: profile.playerId,
    email: profile.email,
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    totalGames: Number(profile.totalGames ?? 0),
    xp: Number(profile.xp ?? 0),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastLoginAt: profile.lastLoginAt,
  };
}

function cleanCrProfile(snapshot, tag) {
  if (!tag) return undefined;
  return {
    tag,
    status: snapshot?.status ?? "unavailable",
    name: snapshot?.name,
    clan: snapshot?.clan,
    accountAge: snapshot?.accountAge,
    cardCount: Array.isArray(snapshot?.cards)
      ? snapshot.cards.length
      : undefined,
    fetchedAt: snapshot?.fetchedAt,
    refreshRequestedAt: snapshot?.refreshRequestedAt,
    updatedAt: snapshot?.updatedAt,
  };
}

export async function accountDirectory(doc = client()) {
  const profiles = await scanProfiles(doc);
  const snapshots = await batchCrProfiles(
    doc,
    profiles.map((profile) => profile.playerTag),
  );
  return profiles
    .filter((profile) => typeof profile.playerId === "string")
    .map((profile) => {
      const clashRoyale = cleanCrProfile(
        snapshots.get(profile.playerTag),
        profile.playerTag,
      );
      return {
        ...cleanProfile(profile),
        ...(clashRoyale
          ? {
              clashName: clashRoyale.name,
              clanName: clashRoyale.clan?.name,
              clanTag: clashRoyale.clan?.tag,
            }
          : {}),
      };
    });
}

export async function accountDetail(doc, playerId, knownProfile) {
  const profile = knownProfile ?? (await findProfile(doc, playerId));
  if (!profile) return undefined;
  const snapshots = await batchCrProfiles(
    doc,
    profile.playerTag ? [profile.playerTag] : [],
  );
  const changes = [];
  let lastKey;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :change)",
        ExpressionAttributeValues: {
          ":pk": `CONTROL#PLAYER#${playerId}`,
          ":change": "CHANGE#",
        },
        ProjectionExpression:
          "sk, playerId, changedFields, #before, #after, reason, #operator, changedAt, schemaVersion",
        ExpressionAttributeNames: {
          "#before": "before",
          "#after": "after",
          "#operator": "operator",
        },
        ScanIndexForward: false,
        Limit: 50,
        ExclusiveStartKey: lastKey,
      }),
    );
    changes.push(
      ...(result.Items ?? []).map(({ sk: _sk, ...change }) => change),
    );
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && changes.length < 50);
  return {
    account: cleanProfile(profile),
    clashRoyale: cleanCrProfile(
      snapshots.get(profile.playerTag),
      profile.playerTag,
    ),
    changes,
  };
}
