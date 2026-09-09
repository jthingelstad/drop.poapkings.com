#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { SignatureV4 } from "@smithy/signature-v4";

export const UPDATES_PUBLISHER_ROLE_NAME = "elixir-drop-updates-publisher";
const MAX_UPDATES = 500;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");

class Sha256 {
  constructor(secret) {
    this.hash = secret ? createHmac("sha256", secret) : createHash("sha256");
  }

  update(value) {
    this.hash.update(value);
  }

  async digest() {
    return this.hash.digest();
  }
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

export function isExpectedPublisherIdentity(identity) {
  const arn = typeof identity?.Arn === "string" ? identity.Arn : "";
  return new RegExp(
    `^arn:(?:aws|aws-cn|aws-us-gov):sts::\\d{12}:assumed-role/${UPDATES_PUBLISHER_ROLE_NAME}/[^/]+$`,
  ).test(arn);
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

async function verifiedSigner(region) {
  const identityClient = new STSClient({ region });
  const identity = await identityClient.send(new GetCallerIdentityCommand({}));
  if (!isExpectedPublisherIdentity(identity))
    throw new Error(
      `AWS caller must be an assumed-role session for ${UPDATES_PUBLISHER_ROLE_NAME}`,
    );
  return new SignatureV4({
    credentials: identityClient.config.credentials,
    region,
    service: "execute-api",
    sha256: Sha256,
  });
}

export async function publishUpdate(
  entry,
  { fetchImpl = fetch, baseUrl, signer, region } = {},
) {
  const root = baseUrl ?? (await apiBaseUrl());
  const url = new URL(`${root}/admin/updates`);
  const body = JSON.stringify(entry);
  const signingRegion =
    region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!signer && !signingRegion)
    throw new Error("Set AWS_REGION for the Updates publisher");
  const requestSigner = signer ?? (await verifiedSigner(signingRegion));

  const signed = await requestSigner.sign({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    method: "POST",
    path: url.pathname,
    query: {},
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: url.host,
    },
    body,
  });

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: signed.headers,
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
  const { positional, flags } = parseFlags(args);
  const command = positional[0] ?? "list";
  if (command === "list") {
    const limit = flags.limit === undefined ? 25 : Number(flags.limit);
    const result = await listUpdates({ limit });
    return flags.json ? printJson(result) : printList(result);
  }
  if (command === "publish") {
    return printJson(await publishUpdate(entryFromFlags(flags)));
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
