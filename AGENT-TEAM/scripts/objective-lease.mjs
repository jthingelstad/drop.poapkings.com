#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  closeSync,
  constants,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const OBJECTIVES = new Set(["run", "grow", "fair-play"]);
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const DEFAULT_LEASE_PATH = path.resolve(
  REPO_ROOT,
  execFileSync("git", ["rev-parse", "--git-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim(),
  "agent-team-objective-lease.json",
);

function assertObjective(objective) {
  if (!OBJECTIVES.has(objective)) {
    throw new Error(
      `unknown objective ${JSON.stringify(objective)}; choose run, grow, or fair-play`,
    );
  }
}

export function readLease(leasePath = DEFAULT_LEASE_PATH) {
  try {
    return JSON.parse(readFileSync(leasePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`objective lease is unreadable: ${error.message}`, {
      cause: error,
    });
  }
}

export function claimLease(objective, options = {}) {
  assertObjective(objective);
  const leasePath = options.leasePath ?? DEFAULT_LEASE_PATH;
  const now = options.now ?? new Date();
  const leaseId = options.leaseId ?? randomUUID();
  if (!leaseId) throw new Error("leaseId must not be empty");
  const payload = {
    objective,
    leaseId,
    claimedAt: now.toISOString(),
    holderId:
      options.holderId ??
      process.env.CODEX_THREAD_ID ??
      "untracked-manual-holder",
    holderPid: options.holderPid ?? process.ppid,
    hostname: options.hostname ?? hostname(),
    startingHead:
      options.startingHead ??
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: options.repoRoot ?? REPO_ROOT,
        encoding: "utf8",
      }).trim(),
  };
  let descriptor;
  try {
    descriptor = openSync(
      leasePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `checkout lease is already held: ${JSON.stringify(readLease(leasePath))}`,
      );
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  return payload;
}

export function assertLeaseOwner(
  objective,
  leaseId,
  leasePath = DEFAULT_LEASE_PATH,
) {
  assertObjective(objective);
  if (!leaseId) throw new Error("leaseId is required");
  const current = readLease(leasePath);
  if (!current) throw new Error("checkout lease is not held");
  if (current.objective !== objective || current.leaseId !== leaseId) {
    throw new Error(
      `checkout lease belongs to another run: ${JSON.stringify({ objective: current.objective, claimedAt: current.claimedAt })}`,
    );
  }
  return current;
}

export function releaseLease(
  objective,
  leaseId,
  leasePath = DEFAULT_LEASE_PATH,
  repoRoot = REPO_ROOT,
) {
  assertObjective(objective);
  if (!leaseId) throw new Error("leaseId is required");
  const current = readLease(leasePath);
  if (!current) return null;
  assertLeaseOwner(objective, leaseId, leasePath);
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (dirty)
    throw new Error("refusing to release a lease while the worktree is dirty");
  unlinkSync(leasePath);
  return current;
}

export function clearStaleLease(options = {}) {
  const leasePath = options.leasePath ?? DEFAULT_LEASE_PATH;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const hours = options.hours;
  const now = options.now ?? new Date();
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error("--hours must be positive");
  const current = readLease(leasePath);
  if (!current) throw new Error("no checkout lease exists");
  const claimedAt = new Date(current.claimedAt);
  if (Number.isNaN(claimedAt.valueOf()))
    throw new Error("objective lease has no valid claimedAt");
  const ageMs = now.valueOf() - claimedAt.valueOf();
  if (ageMs < hours * 60 * 60 * 1000) {
    throw new Error(`objective lease is not yet ${hours} hours old`);
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (dirty)
    throw new Error(
      "refusing to clear a stale lease while the worktree is dirty",
    );
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (current.startingHead !== currentHead)
    throw new Error(
      "refusing automatic stale clear because HEAD changed; inspect and clear manually",
    );
  const currentHostname = options.hostname ?? hostname();
  if (current.hostname !== currentHostname)
    throw new Error(
      "cannot prove a lease holder on another host is inactive; inspect and clear manually",
    );
  if (!Number.isInteger(current.holderPid))
    throw new Error(
      "lease has no durable holder process; inspect and clear manually",
    );
  const processExists =
    options.processExists ??
    ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    });
  if (!processExists(current.holderPid)) {
    unlinkSync(leasePath);
    return current;
  }
  throw new Error(`lease holder process ${current.holderPid} is still active`);
}

export function clearManualLease(options = {}) {
  const leasePath = options.leasePath ?? DEFAULT_LEASE_PATH;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const current = readLease(leasePath);
  if (!current) throw new Error("no checkout lease exists");
  if (!options.confirmInactive)
    throw new Error("manual clear requires --confirm-inactive");
  const recorded = current.holderId ?? "legacy-unidentified";
  if (recorded !== options.holderId)
    throw new Error(`lease holder is ${JSON.stringify(recorded)}`);
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (dirty)
    throw new Error("refusing to clear a lease while the worktree is dirty");
  unlinkSync(leasePath);
  return current;
}

function usage() {
  return "usage: objective-lease.mjs claim <objective> | check|release <objective> <leaseId> | status | clear-stale --hours <n> | clear-manual --holder-id <id> --confirm-inactive";
}

function main(argv) {
  const [command, objective, token] = argv;
  let result;
  if (command === "claim" && objective) result = claimLease(objective);
  else if (command === "check" && objective && token)
    result = assertLeaseOwner(objective, token);
  else if (command === "release" && objective && token)
    result = releaseLease(objective, token);
  else if (command === "status" && !objective) result = readLease();
  else if (command === "clear-stale" && objective === "--hours" && token) {
    result = clearStaleLease({ hours: Number(token) });
  } else if (
    command === "clear-manual" &&
    objective === "--holder-id" &&
    token &&
    argv[3] === "--confirm-inactive"
  ) {
    result = clearManualLease({ holderId: token, confirmInactive: true });
  } else throw new Error(usage());
  process.stdout.write(`${JSON.stringify({ status: "ok", lease: result })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
