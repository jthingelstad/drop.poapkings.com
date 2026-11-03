// Shared conventions + helpers for the bounded Fair Play referee scripts.
//
// These scripts are a documented, sanitized evidence and decision surface over
// the Drop game table. They import NOTHING from services/api
// (workspace-boundary rule); key conventions are duplicated here on purpose.
//
// Hard rules (enforced by sanitize + the callers):
//   * Never print `sub`, email, a raw IP, a raw user-agent, or the pepper.
//   * The referee sees only the pseudonymous `playerId`, opaque correlation
//     hashes, and the normalized (unverified) player tag.
//   * Fail closed: on missing creds / not found / incomplete evidence, print a
//     `{ "status": "insufficient_evidence", ... }` object and exit non-zero.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  acquireProductionLock,
  ProductionLockHeldError,
} from "./production-lock.mjs";

export const TABLE_NAME =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";

const RUN_REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function compactReference(id, prefix) {
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= BigInt(id.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  let value = hash & ((1n << 50n) - 1n);
  let code = "";
  for (let index = 0; index < 10; index += 1) {
    code = RUN_REFERENCE_ALPHABET[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return `#${prefix}${code}`;
}

export function runReference(runId) {
  return compactReference(runId, "D");
}

export function playerReference(playerId) {
  return compactReference(playerId, "P");
}

// Sensitive attributes that must never leave these scripts. `owner` is the sub
// on the ephemeral RUN#{runId} item; `GSI1SK` is the leaderboard sort key, which
// ends in the raw sub; `dropSub` is the sub on an ELIXIR#{accountId} identity
// pointer. All are internal identifiers wearing an innocent name.
export const FORBIDDEN_KEYS = Object.freeze([
  "sub",
  "playerSub",
  "owner",
  "dropSub",
  "email",
  "pk",
  "GSI1SK",
]);

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_KEYS);

let cachedDoc;

export const REFEREE_ROLE_NAME = "elixir-drop-referee-read";

function isExpectedRefereeIdentity(identity) {
  const arn = typeof identity?.Arn === "string" ? identity.Arn : "";
  const account = typeof identity?.Account === "string" ? identity.Account : "";
  const match = arn.match(
    /^arn:(?:aws|aws-cn|aws-us-gov):sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/,
  );
  return Boolean(
    match && match[1] === account && match[2] === REFEREE_ROLE_NAME,
  );
}

export async function createVerifiedDocumentClient({
  region,
  identityClient = new STSClient({ region }),
  documentClientFactory = () =>
    DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    }),
} = {}) {
  const identity = await identityClient.send(new GetCallerIdentityCommand({}));
  if (!isExpectedRefereeIdentity(identity)) {
    throw new Error(
      `AWS caller must be an assumed-role session for ${REFEREE_ROLE_NAME}`,
    );
  }
  return documentClientFactory();
}

// A DynamoDB document client using the ambient AWS credential chain (the host
// must have assumed the bounded RefereeReadRole). The caller identity is
// verified before the DynamoDB client is created. Fails closed if the role or
// region cannot be verified.
export async function client() {
  if (cachedDoc) return cachedDoc;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region)
    failClosed("no_aws_region", "Set AWS_REGION for the referee host");
  try {
    cachedDoc = await createVerifiedDocumentClient({ region });
  } catch (error) {
    failClosed(
      "untrusted_aws_identity",
      error instanceof Error ? error.message : "Unable to verify AWS caller",
    );
  }
  return cachedDoc;
}

export function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Print the fail-closed envelope and exit non-zero. `insufficient_evidence` is
// the referee's contract for "I could not responsibly review this".
export function failClosed(reason, detail) {
  print({
    status: "insufficient_evidence",
    reason,
    ...(detail ? { detail } : {}),
  });
  process.exit(1);
}

// The write scripts run their reads and write holding Drop's production lock
// (production-lock.mjs, docs/OPERATIONS.md). A held lock fails closed with
// who holds it since when; the lock is released in `finally`, and on the
// process exit a failClosed() inside `fn` takes.
export async function withProductionLockOrFail(purpose, fn) {
  let lock;
  try {
    lock = acquireProductionLock(purpose);
  } catch (error) {
    failClosed(
      error instanceof ProductionLockHeldError
        ? "production_lock_held"
        : "production_lock_unavailable",
      error instanceof Error ? error.message : "unknown",
    );
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

const playerIdCache = new Map();

// Map an internal subject key to the pseudonymous playerId via the profile.
// Returns undefined if the profile is gone (deleted account).
export async function playerIdForSub(doc, sub) {
  if (playerIdCache.has(sub)) return playerIdCache.get(sub);
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `PLAYER#${sub}`, sk: "PROFILE" },
      ProjectionExpression: "playerId",
    }),
  );
  const playerId = result.Item?.playerId;
  playerIdCache.set(sub, playerId);
  return playerId;
}

// Reverse map: find the subject key that owns a given pseudonymous playerId.
// Profiles are the only PROFILE items carrying playerId, so a filtered scan
// resolves it (bounded at beta scale). Never emit the sub it returns.
export async function subForPlayerId(doc, playerId) {
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "sk = :profile AND playerId = :playerId",
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":playerId": playerId,
        },
        ProjectionExpression: "pk, playerId",
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if (typeof item.pk === "string" && item.pk.startsWith("PLAYER#")) {
        return item.pk.slice("PLAYER#".length);
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return undefined;
}

// Strip forbidden identifiers from an item and stamp the pseudonymous playerId
// in their place. Deep-cleans nested objects/arrays so no `sub`/email hides in a
// nested field. Correlation hashes and the normalized tag are opaque and remain.
export function sanitize(item, playerId) {
  const cleaned = stripForbidden(item);
  return { playerId, ...cleaned };
}

export function sanitizeRecord(item) {
  return stripForbidden(item);
}

function stripForbidden(value) {
  if (Array.isArray(value)) return value.map(stripForbidden);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEY_SET.has(key)) continue;
      output[key] = stripForbidden(inner);
    }
    return output;
  }
  return value;
}

export async function findEvidenceByRunId(doc, runIdentifier) {
  const referenceLookup = /^#D[0-9A-HJKMNP-TV-Z]{10}$/i.test(runIdentifier);
  const normalizedReference = runIdentifier.toUpperCase();
  const matches = [];
  let lastKey;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: referenceLookup
          ? "begins_with(sk, :evidence)"
          : "begins_with(sk, :evidence) AND runId = :runId",
        ExpressionAttributeValues: referenceLookup
          ? { ":evidence": "EVIDENCE#" }
          : { ":evidence": "EVIDENCE#", ":runId": runIdentifier },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const evidence of result.Items ?? []) {
      if (
        !referenceLookup ||
        (typeof evidence.runId === "string" &&
          runReference(evidence.runId) === normalizedReference)
      )
        matches.push(evidence);
    }
    if (!referenceLookup && matches.length) return matches[0];
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  if (matches.length > 1)
    throw new Error(`Run reference ${normalizedReference} is ambiguous`);
  return matches[0];
}

export async function loadDecisions(doc, runIds) {
  const decisions = new Map();
  const uniqueIds = [...new Set(runIds.filter(Boolean))];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    let keys = uniqueIds
      .slice(offset, offset + 100)
      .map((runId) => ({ pk: `REFEREE#${runId}`, sk: "CURRENT" }));
    for (let attempt = 0; keys.length && attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const result = await doc.send(
        new BatchGetCommand({
          RequestItems: {
            [TABLE_NAME]: { Keys: keys, ConsistentRead: true },
          },
        }),
      );
      for (const item of result.Responses?.[TABLE_NAME] ?? []) {
        decisions.set(String(item.runId), item);
      }
      keys = result.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
    }
    if (keys.length)
      throw new Error(
        `Referee decisions remained unavailable for ${keys.length} run(s)`,
      );
  }
  return decisions;
}

export async function currentDecision(doc, runId) {
  const result = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `REFEREE#${runId}`, sk: "CURRENT" },
      ConsistentRead: true,
    }),
  );
  return result.Item;
}

// Mirror of referee-status.ts#isExcludedFromBoards. Every run ranks on
// finishing; only a person's hidden decision after a hand investigation removes
// one from the public board, where the player's next eligible run replaces it.
// Legacy records stay in the table and are ignored: an automatic integrity-gate
// hold and a reopened queue hold (queueState "pending") were never a person's
// final call, so both runs rank. An unrecognized author fails closed.
export function isExcludedFromBoards(decision) {
  if (decision?.visibility !== "hidden") return false;
  return (
    decision.queueState !== "pending" && decision.decidedBy !== "integrity-gate"
  );
}

// Minimal --flag <value> / --flag parser. Bare flags become `true`.
export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

export { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand };
