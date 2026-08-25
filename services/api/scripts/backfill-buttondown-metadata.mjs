#!/usr/bin/env node
// Backfill Drop-owned metadata on existing Buttondown subscribers. Dry-run by
// default; pass --apply to PATCH metadata. Subscriber lifecycle state is never
// sent, missing subscribers block the apply, and output contains aggregates
// only so neither player emails nor credentials enter operator logs.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  paginateScan,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  desiredButtondownBackfillMetadata,
  managedButtondownMetadataMatches,
  mergeButtondownBackfillMetadata,
  parseButtondownBackfillArgs,
  reconcileButtondownLastSeasonPlayed,
} from "../src/maintenance/buttondown-backfill.js";
import { dropPlayerTag } from "../src/recruiter.js";

const BUTTONDOWN_API = "https://api.buttondown.com/v1";
const BUTTONDOWN_API_VERSION = "2026-04-01";
const VALID_CR_STATUSES = new Set([
  "pending",
  "ready",
  "not_found",
  "unavailable",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function loadButtondownConfig(envFile) {
  let values = process.env;
  if (envFile) {
    const path = resolve(envFile);
    const fileStat = await stat(path);
    if ((fileStat.mode & 0o077) !== 0)
      throw new Error("Buttondown environment file must use mode 0600");
    values = parseEnv(await readFile(path, "utf8"));
  }
  const apiKey = values.BUTTONDOWN_API_KEY?.trim();
  const newsletterId = values.BUTTONDOWN_NEWSLETTER_ID?.trim();
  const appUrl = values.APP_URL?.trim();
  if (!apiKey || !newsletterId || !appUrl)
    throw new Error(
      "BUTTONDOWN_API_KEY, BUTTONDOWN_NEWSLETTER_ID, and APP_URL are required",
    );
  return { apiKey, newsletterId, appUrl };
}

function buttondownHeaders(config, json = false) {
  return {
    Authorization: `Token ${config.apiKey}`,
    "Buttondown-Context": config.newsletterId,
    "X-API-Version": BUTTONDOWN_API_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function retryDelay(response, attempt) {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = Number(retryAfterHeader);
  if (
    retryAfterHeader !== null &&
    Number.isFinite(retryAfter) &&
    retryAfter >= 0
  )
    return Math.min(retryAfter * 1_000, 5_000);
  return 250 * 2 ** attempt;
}

async function buttondownRequest(config, method, path, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`${BUTTONDOWN_API}${path}`, {
        method,
        headers: buttondownHeaders(config, body !== undefined),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw new Error(
        `Buttondown ${method} failed with ${error instanceof Error ? error.name : "UnknownError"}`,
      );
    }
    if (response.status === 404) {
      await response.arrayBuffer();
      return undefined;
    }
    if (!response.ok) {
      await response.arrayBuffer();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new Error(
        `Buttondown ${method} failed with HTTP ${response.status}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`Buttondown ${method} returned invalid JSON`);
    }
  }
  throw new Error(`Buttondown ${method} exhausted retries`);
}

async function loadProfiles(documentClient, tableName) {
  const profiles = [];
  for await (const page of paginateScan(
    { client: documentClient },
    {
      TableName: tableName,
      FilterExpression: "sk = :profile AND begins_with(pk, :player)",
      ExpressionAttributeValues: {
        ":profile": "PROFILE",
        ":player": "PLAYER#",
      },
      ProjectionExpression:
        "pk, sk, email, playerId, playerTag, totalGames, lastSeasonPlayed",
      Select: "SPECIFIC_ATTRIBUTES",
    },
  )) {
    for (const item of page.Items ?? []) {
      const totalGames = Number(item.totalGames ?? 0);
      if (
        typeof item.pk !== "string" ||
        !item.pk.startsWith("PLAYER#") ||
        typeof item.email !== "string" ||
        !item.email ||
        typeof item.playerId !== "string" ||
        !UUID_PATTERN.test(item.playerId) ||
        !Number.isSafeInteger(totalGames) ||
        totalGames < 0 ||
        (item.lastSeasonPlayed !== undefined &&
          (!Number.isSafeInteger(item.lastSeasonPlayed) ||
            item.lastSeasonPlayed <= 0)) ||
        (item.playerTag !== undefined && typeof item.playerTag !== "string")
      )
        throw new Error("A player profile cannot be safely backfilled");
      profiles.push({
        pk: item.pk,
        email: item.email,
        playerId: item.playerId,
        ...(item.playerTag ? { playerTag: item.playerTag } : {}),
        totalGames,
        ...(item.lastSeasonPlayed !== undefined
          ? { lastSeasonPlayed: item.lastSeasonPlayed }
          : {}),
      });
    }
  }
  return profiles;
}

async function latestRunSeasonId(documentClient, tableName, profile) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": profile.pk,
        ":prefix": "RUN#",
      },
      ProjectionExpression: "seasonId",
      ScanIndexForward: false,
      Limit: 1,
      ConsistentRead: true,
    }),
  );
  return result.Items?.[0]?.seasonId;
}

async function hydrateLastSeasonPlayed(documentClient, tableName, profiles) {
  const hydrated = [];
  const profileUpdates = [];
  let unresolvedLastSeasonPlayed = 0;
  for (const profile of profiles) {
    const seasonId = profile.totalGames
      ? await latestRunSeasonId(documentClient, tableName, profile)
      : undefined;
    const reconciliation = reconcileButtondownLastSeasonPlayed(
      profile,
      seasonId,
    );
    if (!reconciliation.resolved) {
      unresolvedLastSeasonPlayed += 1;
      hydrated.push(profile);
      continue;
    }
    if (!reconciliation.profileUpdate) {
      hydrated.push(profile);
      continue;
    }
    const next = {
      ...profile,
      lastSeasonPlayed: reconciliation.lastSeasonPlayed,
    };
    hydrated.push(next);
    profileUpdates.push(next);
  }
  return { hydrated, profileUpdates, unresolvedLastSeasonPlayed };
}

async function applyLastSeasonPlayed(documentClient, tableName, profile) {
  try {
    const result = await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: profile.pk, sk: "PROFILE" },
        UpdateExpression: "SET lastSeasonPlayed = :season",
        ConditionExpression:
          "attribute_exists(pk) AND (attribute_not_exists(lastSeasonPlayed) OR lastSeasonPlayed < :season)",
        ExpressionAttributeValues: { ":season": profile.lastSeasonPlayed },
        ReturnValues: "ALL_NEW",
      }),
    );
    if (result.Attributes?.lastSeasonPlayed !== profile.lastSeasonPlayed)
      throw new Error("Last season played profile verification failed");
    return true;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.name !== "ConditionalCheckFailedException"
    )
      throw error;
    const current = await documentClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: profile.pk, sk: "PROFILE" },
        ConsistentRead: true,
        ProjectionExpression: "lastSeasonPlayed",
      }),
    );
    if (
      Number.isSafeInteger(current.Item?.lastSeasonPlayed) &&
      current.Item.lastSeasonPlayed >= profile.lastSeasonPlayed
    )
      return false;
    throw new Error("Last season played profile update raced an unsafe state");
  }
}

async function ensureRecruiterAlias(documentClient, tableName, profile) {
  const playerTag = dropPlayerTag(profile.playerId).slice(1);
  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: `RECRUITER#${playerTag}`,
        sk: "INVITE",
        playerId: profile.playerId,
      },
      ConditionExpression: "attribute_not_exists(pk) OR playerId = :playerId",
      ExpressionAttributeValues: {
        ":playerId": profile.playerId,
      },
    }),
  );
}

async function loadCrSnapshots(documentClient, tableName, profiles) {
  const snapshots = new Map();
  const tags = [
    ...new Set(profiles.map((profile) => profile.playerTag).filter(Boolean)),
  ];
  for (let offset = 0; offset < tags.length; offset += 100) {
    let keys = tags.slice(offset, offset + 100).map((tag) => ({
      pk: `CR_PLAYER#${tag}`,
      sk: "PROFILE",
    }));
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      const page = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: keys,
              ProjectionExpression: "pk, sk, #tag, #status, clan",
              ExpressionAttributeNames: {
                "#tag": "tag",
                "#status": "status",
              },
            },
          },
        }),
      );
      for (const item of page.Responses?.[tableName] ?? []) {
        if (typeof item.tag === "string" && VALID_CR_STATUSES.has(item.status))
          snapshots.set(item.tag, { status: item.status, clan: item.clan });
      }
      keys = page.UnprocessedKeys?.[tableName]?.Keys ?? [];
    }
    if (keys.length)
      throw new Error(
        `Clash Royale snapshots unavailable for ${keys.length} player tag(s)`,
      );
  }
  return snapshots;
}

async function main() {
  const { apply, envFile, tableName } = parseButtondownBackfillArgs(
    process.argv.slice(2),
  );
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the backfill");

  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!(identity.Arn ?? "").includes(":assumed-role/elixir-drop-control/"))
    throw new Error("Backfill requires the elixir-drop-control assumed role");

  const buttondown = await loadButtondownConfig(envFile);
  const documentClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  const loadedProfiles = await loadProfiles(documentClient, tableName);
  const {
    hydrated: profiles,
    profileUpdates,
    unresolvedLastSeasonPlayed,
  } = await hydrateLastSeasonPlayed(documentClient, tableName, loadedProfiles);
  const snapshots = await loadCrSnapshots(documentClient, tableName, profiles);
  const plans = [];
  let matchedSubscribers = 0;
  let missingSubscribers = 0;
  let alreadyCurrent = 0;
  let linkedPlayerTags = 0;
  let knownClanTags = 0;

  for (const profile of profiles) {
    const snapshot = profile.playerTag
      ? snapshots.get(profile.playerTag)
      : undefined;
    if (profile.playerTag) linkedPlayerTags += 1;
    if (snapshot?.status === "ready" && snapshot.clan?.tag) knownClanTags += 1;
    const subscriber = await buttondownRequest(
      buttondown,
      "GET",
      `/subscribers/${encodeURIComponent(profile.email)}`,
    );
    if (!subscriber) {
      missingSubscribers += 1;
      continue;
    }
    matchedSubscribers += 1;
    const desired = desiredButtondownBackfillMetadata(
      profile,
      buttondown.appUrl,
      snapshot,
    );
    const metadata = mergeButtondownBackfillMetadata(
      subscriber.metadata,
      desired,
    );
    if (!metadata) {
      alreadyCurrent += 1;
      continue;
    }
    plans.push({ profile, desired, metadata });
  }

  const summary = {
    status: apply ? "applied" : "dry_run",
    table: tableName,
    callerRole: "drop-control",
    profiles: profiles.length,
    matchedSubscribers,
    missingSubscribers,
    linkedPlayerTags,
    knownClanTags,
    profilesWithStoredLastSeasonPlayed: loadedProfiles.filter(
      (profile) => profile.lastSeasonPlayed !== undefined,
    ).length,
    derivedLastSeasonPlayed: profileUpdates.length,
    unresolvedLastSeasonPlayed,
    alreadyCurrent,
    plannedUpdates: plans.length,
    plannedProfileUpdates: profileUpdates.length,
    appliedUpdates: 0,
    verifiedUpdates: 0,
    failedUpdates: 0,
    recruiterAliasesEnsured: 0,
    appliedProfileUpdates: 0,
    profileUpdatesAlreadyCurrent: 0,
  };

  if (!apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (missingSubscribers)
    throw new Error(
      `${missingSubscribers} player profile(s) have no Buttondown subscriber; refusing metadata-only apply`,
    );
  if (unresolvedLastSeasonPlayed)
    throw new Error(
      `${unresolvedLastSeasonPlayed} player profile(s) have recorded games without a resolvable Clash Royale season number; refusing partial apply`,
    );

  for (const profile of profiles) {
    await ensureRecruiterAlias(documentClient, tableName, profile);
    summary.recruiterAliasesEnsured += 1;
  }

  for (const profile of profileUpdates) {
    if (await applyLastSeasonPlayed(documentClient, tableName, profile))
      summary.appliedProfileUpdates += 1;
    else summary.profileUpdatesAlreadyCurrent += 1;
  }

  const failures = {};
  for (const plan of plans) {
    try {
      const updated = await buttondownRequest(
        buttondown,
        "PATCH",
        `/subscribers/${encodeURIComponent(plan.profile.email)}`,
        { metadata: plan.metadata },
      );
      summary.appliedUpdates += 1;
      if (!managedButtondownMetadataMatches(updated?.metadata, plan.desired))
        throw new Error("Buttondown PATCH verification failed");
      summary.verifiedUpdates += 1;
    } catch (error) {
      summary.failedUpdates += 1;
      const reason = error instanceof Error ? error.message : "UnknownError";
      failures[reason] = (failures[reason] ?? 0) + 1;
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ...summary,
        ...(summary.failedUpdates ? { failures } : {}),
      },
      null,
      2,
    )}\n`,
  );
  if (summary.failedUpdates) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Buttondown metadata backfill failed"}\n`,
  );
  process.exitCode = 1;
});
