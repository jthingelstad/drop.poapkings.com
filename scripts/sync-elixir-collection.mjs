#!/usr/bin/env node
/**
 * Sync every Drop player who has saved a Clash Royale tag into the
 * Elixir MCP collection.
 *
 *   node scripts/sync-elixir-collection.mjs --dry-run
 *   node scripts/sync-elixir-collection.mjs
 *
 * Run from the repo root with the root .env loaded (it holds
 * ELIXIR_MCP_KEY) and AWS credentials for the Drop table.
 *
 * The API adds a tag on every login and on every tag save, so this is
 * not the ongoing mechanism. It is the initial backfill for accounts
 * that saved a tag before the hub existed, and a repair if the hub was
 * unreachable when somebody signed in. Idempotent: safe to re-run.
 *
 * NOT a 'set': it only adds. Drop is one source of members, and
 * replacing the membership wholesale would evict anyone a curator put
 * in the collection by hand.
 */

import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dryRun = process.argv.includes("--dry-run");
const TABLE =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
const SLUG = process.env.ELIXIR_MCP_COLLECTION_SLUG || "elixir-drop";
const BASE = (
  process.env.ELIXIR_MCP_BASE_URL || "https://elixir.poapkings.com"
).replace(/\/$/, "");
const BATCH = 500; // the hub's per-call ceiling

// Load the root .env only for the key, and never print it.
function elixirKey() {
  if (process.env.ELIXIR_MCP_KEY?.trim())
    return process.env.ELIXIR_MCP_KEY.trim();
  try {
    for (const line of readFileSync(
      new URL("../.env", import.meta.url),
      "utf8",
    ).split("\n")) {
      const m = /^\s*ELIXIR_MCP_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env here */
  }
  return undefined;
}

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

/** Every PROFILE item that carries a tag. Runs live under the same pk
 *  prefix, so the sk filter is what makes this count ACCOUNTS. */
async function dropPlayerTags() {
  const tags = new Set();
  let ExclusiveStartKey;
  let accounts = 0;
  do {
    const page = await db.send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression: "playerTag",
        FilterExpression: "begins_with(pk, :p) AND sk = :s",
        ExpressionAttributeValues: { ":p": "PLAYER#", ":s": "PROFILE" },
        ExclusiveStartKey,
      }),
    );
    for (const item of page.Items ?? []) {
      accounts += 1;
      if (typeof item.playerTag === "string" && item.playerTag.trim()) {
        tags.add(item.playerTag.trim().toUpperCase());
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { tags: [...tags].sort((a, b) => a.localeCompare(b)), accounts };
}

async function addBatch(key, tags) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "collections_edit",
        arguments: { slug: SLUG, action: "add", tags },
      },
    }),
  });
  if (!res.ok) throw new Error(`hub HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "hub error");
  const text = body.result?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : {};
  if (body.result?.isError) {
    throw new Error(parsed.message ?? parsed.error ?? "tool refused");
  }
  return parsed;
}

const { tags, accounts } = await dropPlayerTags();
console.error(
  `${accounts} Drop accounts, ${tags.length} distinct player tags. ` +
    `The rest never saved one — the tag is optional and stays out of setup.`,
);
if (tags.length === 0) process.exit(0);

if (dryRun) {
  console.error(`--dry-run: would add ${tags.length} tags to '${SLUG}'.`);
  for (const t of tags) console.error(`  ${t}`);
  process.exit(0);
}

const key = elixirKey();
if (!key) {
  console.error("ELIXIR_MCP_KEY is not set (root .env or the environment).");
  process.exit(1);
}

let added = 0;
let started = 0;
let members = 0;
for (let i = 0; i < tags.length; i += BATCH) {
  const slice = tags.slice(i, i + BATCH);
  const r = await addBatch(key, slice);
  added += r.added ?? 0;
  started += r.recordings_started ?? 0;
  members = r.members ?? members;
  console.error(
    `  batch ${i / BATCH + 1}: +${r.added} added, ${r.recordings_started} now recording`,
  );
}
console.error(
  `\nDone. '${SLUG}' holds ${members} players; ${added} added, ${started} recordings started.`,
);
