#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const UPDATES_PUBLISH_TOKEN_ENV = "ELIXIR_DROP_UPDATES_PUBLISH_TOKEN";
export const PLAYER_UPDATES_USAGE = `Player Updates CLI

Usage:
  node AGENT-TEAM/scripts/player-updates.mjs list [--limit 1-500] [--json]
  node AGENT-TEAM/scripts/player-updates.mjs publish --kind <feature|season|message> --title <subject> --body <markdown> [--impact <category>] [--id <kebab-id>] [--published-at <ISO-date-time>]

Feature impact categories:
  gameplay, learning, competition, progression, access, sharing, identity, account-privacy

Publishing reads ${UPDATES_PUBLISH_TOKEN_ENV} from the environment or the repository's mode-0600 .env. It does not use AWS credentials. Ordinary publications omit --id and --published-at; the CLI supplies both.`;
const MAX_UPDATES = 500;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");

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

function envValue(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals < 1 || trimmed.slice(0, equals).trim() !== name) continue;
    const raw = trimmed.slice(equals + 1).trim();
    try {
      return raw.startsWith('"') ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }
  return undefined;
}

export async function resolveUpdatesPublishToken({
  environment = process.env,
  readFileImpl = readFile,
} = {}) {
  const configured = environment[UPDATES_PUBLISH_TOKEN_ENV]?.trim();
  const token =
    configured ||
    String(
      envValue(
        await readFileImpl(resolve(repoRoot, ".env"), "utf8").catch(() => ""),
        UPDATES_PUBLISH_TOKEN_ENV,
      ) ?? "",
    ).trim();
  if (token.length < 32)
    throw new Error(
      `Set ${UPDATES_PUBLISH_TOKEN_ENV} in the environment or the repository's mode-0600 .env`,
    );
  return token;
}

export function updateId(title, date = new Date()) {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .replace(/-$/g, "");
  if (!slug) throw new Error("Title must contain a letter or number");
  return `${date.toISOString().slice(0, 10)}-${slug}`;
}

async function apiBaseUrl() {
  const override = process.env.DROP_API_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  const config = JSON.parse(
    await readFile(
      resolve(repoRoot, "apps/web/public/api-config.json"),
      "utf8",
    ),
  );
  if (typeof config.apiBaseUrl !== "string" || !config.apiBaseUrl.trim())
    throw new Error("apps/web/public/api-config.json has no API URL");
  return config.apiBaseUrl.replace(/\/$/, "");
}

async function responsePayload(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Updates API returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    const detail = payload?.error?.message ?? payload?.detail ?? payload?.error;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Updates API request failed (${response.status})`,
    );
  }
  return payload;
}

export async function listUpdates({
  limit = 25,
  fetchImpl = fetch,
  baseUrl,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_UPDATES)
    throw new Error(`--limit must be 1-${MAX_UPDATES}`);
  const root = baseUrl ?? (await apiBaseUrl());
  const response = await fetchImpl(
    `${root}/updates?limit=${encodeURIComponent(limit)}`,
    { headers: { accept: "application/json" } },
  );
  return responsePayload(response);
}

export async function publishUpdate(
  entry,
  { fetchImpl = fetch, baseUrl, token } = {},
) {
  const root = baseUrl ?? (await apiBaseUrl());
  const url = new URL(`${root}/admin/updates`);
  const body = JSON.stringify(entry);
  if (typeof token !== "string" || token.length < 32)
    throw new Error("An Updates publish token is required");

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
      });
      return await responsePayload(response);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(200);
    }
  }
  throw lastError;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printList(result) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (!entries.length) {
    process.stdout.write("No player Updates are published.\n");
    return;
  }
  process.stdout.write(
    `${entries
      .map(
        (entry) =>
          `${entry.publishedAt}  ${String(entry.kind).toUpperCase()}  ${entry.title}\n${entry.body}`,
      )
      .join("\n\n")}\n`,
  );
}

function requiredFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`--${name} is required`);
  return value.trim();
}

export function entryFromFlags(flags, now = new Date()) {
  const title = requiredFlag(flags, "title");
  return {
    id:
      typeof flags.id === "string" && flags.id.trim()
        ? flags.id.trim()
        : updateId(title, now),
    kind: requiredFlag(flags, "kind"),
    ...(typeof flags.impact === "string" && flags.impact.trim()
      ? { impact: flags.impact.trim() }
      : {}),
    publishedAt:
      typeof flags["published-at"] === "string" && flags["published-at"].trim()
        ? flags["published-at"].trim()
        : now.toISOString(),
    title,
    body: requiredFlag(flags, "body"),
  };
}

export async function main(args) {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    process.stdout.write(`${PLAYER_UPDATES_USAGE}\n`);
    return;
  }
  const { positional, flags } = parseFlags(args);
  const command = positional[0] ?? "list";
  if (command === "list") {
    const limit = flags.limit === undefined ? 25 : Number(flags.limit);
    const result = await listUpdates({ limit });
    return flags.json ? printJson(result) : printList(result);
  }
  if (command === "publish") {
    return printJson(
      await publishUpdate(entryFromFlags(flags), {
        token: await resolveUpdatesPublishToken(),
      }),
    );
  }
  throw new Error("Choose list or publish");
}

function fail(error) {
  printJson({
    status: "error",
    detail: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch(fail);
}
