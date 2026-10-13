#!/usr/bin/env node
// Drop's production lock (docs/OPERATIONS.md). Merges deploy through CI,
// whose workflow serializes itself; this lock serializes the writes made to
// production from a checkout instead: a referee decision, a ranked-access
// change, a run-report triage, an Updates publication, and anything run
// through `production-lock.mjs run`. The scripts that write take it
// themselves, for exactly as long as the write runs.
//
// One holder at a time, recorded in the clone's git common directory so the
// main checkout and every worktree of it see the same lock. Acquisition is
// an exclusive create (the record is written in full, then hard-linked into
// place, which fails if the name exists). A refusal names the holder, the
// purpose and since when. A lock whose process no longer exists on this host
// is reclaimed with a warning; a live one is never broken, and there is no
// force flag. The holder releases it in `finally`, and on process exit.

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LOCK_FILE_NAME = "drop-production-lock.json";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_SIGNALS = ["SIGINT", "SIGTERM"];

export class ProductionLockHeldError extends Error {
  constructor(current, lockPath) {
    super(describeRefusal(current));
    this.name = "ProductionLockHeldError";
    this.holder = publicRecord(current);
    this.lockPath = lockPath;
  }
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** The lock file in the git common directory of the clone this script is in. */
export function defaultLockPath(cwd = SCRIPT_DIR) {
  return path.join(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd),
    LOCK_FILE_NAME,
  );
}

function defaultWorktree() {
  try {
    return git(["rev-parse", "--show-toplevel"], SCRIPT_DIR);
  } catch {
    return path.resolve(SCRIPT_DIR, "..");
  }
}

function defaultHolder() {
  const named = process.env.DROP_LOCK_HOLDER?.trim();
  if (named) return named;
  let user = "unknown";
  try {
    user = userInfo().username;
  } catch {
    // A host without a passwd entry still gets a lock; the script names it.
  }
  const script = process.argv[1] ? path.basename(process.argv[1]) : "node";
  return `${user} via ${script}`;
}

/** True unless the process is provably gone (ESRCH). */
export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function formatInZone(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

/** `started_at` as UTC and US Central, for a person reading a refusal. */
export function describeSince(startedAt) {
  const date = new Date(startedAt);
  if (Number.isNaN(date.valueOf())) return `an unreadable time (${startedAt})`;
  return `${formatInZone(date, "UTC")} (${formatInZone(date, "America/Chicago")})`;
}

function publicRecord(record) {
  if (!record || typeof record !== "object") return record;
  const rest = { ...record };
  delete rest.token;
  return rest;
}

function describeHolder(record) {
  return `${record.holder ?? "an unnamed holder"} for "${record.purpose ?? "an unstated purpose"}" since ${describeSince(record.started_at)}, pid ${record.pid} on ${record.host}, worktree ${record.worktree}`;
}

function describeRefusal(record) {
  return `Drop's production lock is held by ${describeHolder(record)}. Nothing was written; run it again once that write finishes.`;
}

/** The current record, null when there is none. Throws on an unreadable file. */
export function readProductionLock(lockPath = defaultLockPath()) {
  let text;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Drop's production lock at ${lockPath} is unreadable; inspect it before any production write.`,
    );
  }
}

// Write the complete record beside the lock, then link it into place: the
// link is the exclusive create, so a reader never sees a half-written lock.
function tryCreate(lockPath, record) {
  const staging = `${lockPath}.${process.pid}.${record.token}.tmp`;
  const descriptor = openSync(staging, "wx", 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(staging, lockPath);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(staging);
  }
}

// Move the stale record aside and remove it only if it is still the one we
// judged dead; a lock someone else took in between is put back untouched.
function reclaim(lockPath, stale) {
  const aside = `${lockPath}.reclaim.${randomUUID()}`;
  try {
    renameSync(lockPath, aside);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  let moved;
  try {
    moved = JSON.parse(readFileSync(aside, "utf8"));
  } catch {
    moved = null;
  }
  if (moved?.token === stale.token) {
    unlinkSync(aside);
    return true;
  }
  try {
    linkSync(aside, lockPath);
  } finally {
    unlinkSync(aside);
  }
  return false;
}

/**
 * Releases the lock only if `record` holds it. Never removes another
 * holder's lock; returns whether this call removed it.
 */
export function releaseProductionLock(
  record,
  { lockPath = defaultLockPath() } = {},
) {
  let current;
  try {
    current = readProductionLock(lockPath);
  } catch {
    return false;
  }
  if (!current || !record?.token || current.token !== record.token)
    return false;
  unlinkSync(lockPath);
  return true;
}

/**
 * Takes the lock or throws ProductionLockHeldError. The returned handle's
 * `release()` is idempotent and holder-only; it also runs on process exit
 * and on SIGINT/SIGTERM, so a script that exits early does not strand it.
 */
export function acquireProductionLock(purpose, options = {}) {
  if (typeof purpose !== "string" || !purpose.trim())
    throw new Error("The production lock needs a purpose");
  const lockPath = options.lockPath ?? defaultLockPath();
  const host = options.host ?? hostname();
  const isAlive = options.processExists ?? processExists;
  const warn = options.warn ?? ((line) => process.stderr.write(`${line}\n`));
  const record = {
    holder: options.holder ?? defaultHolder(),
    purpose: purpose.trim(),
    pid: options.pid ?? process.pid,
    host,
    started_at: (options.now ?? new Date()).toISOString(),
    worktree: options.worktree ?? defaultWorktree(),
    token: randomUUID(),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (tryCreate(lockPath, record)) return lockHandle(lockPath, record);
    const current = readProductionLock(lockPath);
    if (!current) continue;
    const provablyDead =
      current.host === host &&
      Number.isInteger(current.pid) &&
      !isAlive(current.pid);
    if (!provablyDead) throw new ProductionLockHeldError(current, lockPath);
    if (reclaim(lockPath, current))
      warn(
        `production-lock: WARNING reclaimed a lock left by ${describeHolder(current)}; that process no longer exists.`,
      );
  }
  throw new Error(
    `Could not take Drop's production lock at ${lockPath}; it changed hands repeatedly.`,
  );
}

function lockHandle(lockPath, record) {
  let released = false;
  const signalHandlers = new Map();
  const release = () => {
    if (released) return false;
    released = true;
    process.removeListener("exit", release);
    for (const [signal, handler] of signalHandlers)
      process.removeListener(signal, handler);
    return releaseProductionLock(record, { lockPath });
  };
  process.once("exit", release);
  for (const signal of RELEASE_SIGNALS) {
    const handler = () => {
      release();
      process.kill(process.pid, signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  return { lockPath, record: publicRecord(record), release };
}

/** Runs `fn` holding the lock; releases it in `finally`. */
export async function withProductionLock(purpose, fn, options = {}) {
  const lock = acquireProductionLock(purpose, options);
  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}

/** The lock's state for a person: free, or who holds it since when. */
export function productionLockStatus(options = {}) {
  const lockPath = options.lockPath ?? defaultLockPath();
  const current = readProductionLock(lockPath);
  if (!current) return { status: "free", lockPath };
  const host = options.host ?? hostname();
  const isAlive = options.processExists ?? processExists;
  return {
    status: "held",
    lockPath,
    lock: publicRecord(current),
    since: describeSince(current.started_at),
    processGone:
      current.host === host && Number.isInteger(current.pid)
        ? !isAlive(current.pid)
        : null,
  };
}

const USAGE = `usage:
  node scripts/production-lock.mjs status
  node scripts/production-lock.mjs run --purpose <text> -- <command> [args...]

status prints who holds the lock, or "free". run holds it while one command
runs (an out-of-band deploy:api, a data-repair --apply) and exits
with that command's status. There is no command to break a live lock.`;

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "status" && rest.length === 0) {
    process.stdout.write(
      `${JSON.stringify(productionLockStatus(), null, 2)}\n`,
    );
    return 0;
  }
  if (command === "run") {
    const separator = rest.indexOf("--");
    const purposeAt = rest.indexOf("--purpose");
    const purpose =
      purposeAt >= 0 && purposeAt + 1 < separator
        ? rest[purposeAt + 1]
        : undefined;
    const child = separator >= 0 ? rest.slice(separator + 1) : [];
    if (!purpose || child.length === 0) {
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    let lock;
    try {
      lock = acquireProductionLock(purpose);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    try {
      const result = spawnSync(child[0], child.slice(1), { stdio: "inherit" });
      if (result.error) throw result.error;
      return result.status ?? 1;
    } finally {
      lock.release();
    }
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
