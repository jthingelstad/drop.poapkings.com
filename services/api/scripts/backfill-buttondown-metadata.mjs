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
  paginateScan,
} from "@aws-sdk/lib-dynamodb";
import {
  desiredButtondownBackfillMetadata,
  managedButtondownMetadataMatches,
  mergeButtondownBackfillMetadata,
  parseButtondownBackfillArgs,
} from "../src/maintenance/buttondown-backfill.js";

const BUTTONDOWN_API = "https://api.buttondown.com/v1";
const BUTTONDOWN_API_VERSION = "2026-04-01";
const VALID_CR_STATUSES = new Set([
  "pending",
  "ready",
  "not_found",
  "unavailable",
]);

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
  if (!apiKey || !newsletterId)
    throw new Error(
      "BUTTONDOWN_API_KEY and BUTTONDOWN_NEWSLETTER_ID are required",
    );
  return { apiKey, newsletterId };
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
      ProjectionExpression: "pk, sk, email, playerTag, totalGames",
      Select: "SPECIFIC_ATTRIBUTES",
    },
  )) {
    for (const item of page.Items ?? []) {
      const totalGames = Number(item.totalGames ?? 0);
      if (
        typeof item.email !== "string" ||
        !item.email ||
        !Number.isSafeInteger(totalGames) ||
        totalGames < 0 ||
        (item.playerTag !== undefined && typeof item.playerTag !== "string")
      )
        throw new Error("A player profile cannot be safely backfilled");
      profiles.push({
        email: item.email,
        ...(item.playerTag ? { playerTag: item.playerTag } : {}),
        totalGames,
      });
    }
  }
  return profiles;
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
  const profiles = await loadProfiles(documentClient, tableName);
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
    const desired = desiredButtondownBackfillMetadata(profile, snapshot);
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
    alreadyCurrent,
    plannedUpdates: plans.length,
    appliedUpdates: 0,
    verifiedUpdates: 0,
    failedUpdates: 0,
  };

  if (!apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (missingSubscribers)
    throw new Error(
      `${missingSubscribers} player profile(s) have no Buttondown subscriber; refusing metadata-only apply`,
    );

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
