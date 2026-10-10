import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  acquireProductionLock,
  defaultLockPath,
  LOCK_FILE_NAME,
  ProductionLockHeldError,
  productionLockStatus,
  readProductionLock,
  releaseProductionLock,
  withProductionLock,
} from "./production-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_MODULE = pathToFileURL(
  path.join(ROOT, "scripts/production-lock.mjs"),
).href;

function scratch(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "drop-production-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, lockPath: path.join(root, LOCK_FILE_NAME) };
}

// A pid that existed and has exited: the case the lock may reclaim.
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

const quiet = { warn: () => {} };

void test("one holder: a second acquisition is refused with who, what and since when", (t) => {
  const { lockPath } = scratch(t);
  const first = acquireProductionLock("referee decision for #DTEST", {
    lockPath,
    holder: "fair-play-and-season",
    now: new Date("2026-10-10T15:04:05.000Z"),
    worktree: "/tmp/session/drop.poapkings.com",
  });
  t.after(() => first.release());

  const record = readProductionLock(lockPath);
  assert.deepEqual(Object.keys(record).sort(), [
    "holder",
    "host",
    "pid",
    "purpose",
    "started_at",
    "token",
    "worktree",
  ]);
  assert.equal(record.holder, "fair-play-and-season");
  assert.equal(record.purpose, "referee decision for #DTEST");
  assert.equal(record.pid, process.pid);
  assert.equal(record.host, hostname());
  assert.equal(record.started_at, "2026-10-10T15:04:05.000Z");
  assert.equal(record.worktree, "/tmp/session/drop.poapkings.com");
  assert.equal(statSync(lockPath).mode & 0o777, 0o600);
  assert.equal("token" in first.record, false);

  let refusal;
  assert.throws(
    () => acquireProductionLock("Updates publication", { lockPath }),
    (error) => {
      refusal = error;
      return error instanceof ProductionLockHeldError;
    },
  );
  assert.match(refusal.message, /held by fair-play-and-season/);
  assert.match(refusal.message, /"referee decision for #DTEST"/);
  assert.match(refusal.message, /2026-10-10 15:04:05 UTC/);
  assert.match(refusal.message, /2026-10-10 10:04:05 CDT/);
  assert.match(refusal.message, new RegExp(`pid ${process.pid} on `));
  assert.match(
    refusal.message,
    /worktree \/tmp\/session\/drop\.poapkings\.com/,
  );
  assert.match(refusal.message, /Nothing was written/);
  assert.equal("token" in refusal.holder, false);
  // The refusal left the holder's lock exactly as it was.
  assert.deepEqual(readProductionLock(lockPath), record);
});

void test("release is holder-only and idempotent", (t) => {
  const { lockPath } = scratch(t);
  const lock = acquireProductionLock("run-report triage", { lockPath });
  const held = readProductionLock(lockPath);

  assert.equal(
    releaseProductionLock({ ...held, token: "someone-else" }, { lockPath }),
    false,
  );
  assert.equal(releaseProductionLock({}, { lockPath }), false);
  assert.ok(existsSync(lockPath));

  assert.equal(lock.release(), true);
  assert.equal(existsSync(lockPath), false);
  assert.equal(lock.release(), false);

  // A stale handle never removes the next holder's lock.
  const next = acquireProductionLock("Updates publication", { lockPath });
  assert.equal(releaseProductionLock(held, { lockPath }), false);
  assert.equal(readProductionLock(lockPath).purpose, "Updates publication");
  next.release();
});

void test("a lock whose process is gone on this host is reclaimed with a warning", (t) => {
  const { lockPath } = scratch(t);
  const pid = deadPid();
  writeFileSync(
    lockPath,
    JSON.stringify({
      holder: "an earlier run",
      purpose: "referee decision for #DOLD",
      pid,
      host: hostname(),
      started_at: "2026-10-09T11:00:00.000Z",
      worktree: "/tmp/gone",
      token: "stale-token",
    }),
  );
  const warnings = [];
  const lock = acquireProductionLock("referee decision for #DNEW", {
    lockPath,
    warn: (line) => warnings.push(line),
  });
  t.after(() => lock.release());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WARNING reclaimed a lock left by an earlier run/);
  assert.match(warnings[0], /"referee decision for #DOLD"/);
  assert.match(warnings[0], new RegExp(`pid ${pid} `));
  assert.match(warnings[0], /no longer exists/);
  assert.equal(
    readProductionLock(lockPath).purpose,
    "referee decision for #DNEW",
  );
});

void test("a live holder, or one on another host, is never reclaimed", (t) => {
  const { lockPath } = scratch(t);
  const base = {
    holder: "another session",
    purpose: "Updates publication",
    started_at: "2026-10-10T12:00:00.000Z",
    worktree: "/tmp/other",
    token: "their-token",
  };

  writeFileSync(
    lockPath,
    JSON.stringify({ ...base, pid: process.pid, host: hostname() }),
  );
  assert.throws(
    () => acquireProductionLock("triage", { lockPath, ...quiet }),
    ProductionLockHeldError,
  );

  // A dead-looking pid on another host proves nothing about that host.
  writeFileSync(
    lockPath,
    JSON.stringify({ ...base, pid: deadPid(), host: "elsewhere.example" }),
  );
  assert.throws(
    () =>
      acquireProductionLock("triage", {
        lockPath,
        processExists: () => false,
        ...quiet,
      }),
    ProductionLockHeldError,
  );
  assert.equal(readProductionLock(lockPath).token, "their-token");
});

void test("withProductionLock releases in finally, on success and on a throw", async (t) => {
  const { lockPath } = scratch(t);
  const value = await withProductionLock(
    "Updates publication",
    async (lock) => {
      assert.equal(readProductionLock(lockPath).purpose, lock.record.purpose);
      return 42;
    },
    { lockPath },
  );
  assert.equal(value, 42);
  assert.equal(existsSync(lockPath), false);

  await assert.rejects(
    withProductionLock(
      "referee decision",
      async () => {
        throw new Error("write failed");
      },
      { lockPath },
    ),
    /write failed/,
  );
  assert.equal(existsSync(lockPath), false);
});

void test("a holder that exits early or is terminated does not strand the lock", async (t) => {
  const { lockPath } = scratch(t);
  // process.exit() inside the locked work, as failClosed() does.
  const exited = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { withProductionLock } from ${JSON.stringify(LOCK_MODULE)};
       await withProductionLock("referee decision", () => process.exit(3), { lockPath: ${JSON.stringify(lockPath)} });`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(exited.status, 3, exited.stderr);
  assert.equal(existsSync(lockPath), false);

  // SIGTERM while holding it, as the Control Room's timeout sends.
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { acquireProductionLock } from ${JSON.stringify(LOCK_MODULE)};
       acquireProductionLock("referee decision", { lockPath: ${JSON.stringify(lockPath)} });
       process.stdout.write("held\\n");
       setInterval(() => {}, 1000);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("held")) resolve();
    });
    child.on("exit", () => reject(new Error("child exited before holding")));
  });
  assert.ok(existsSync(lockPath));
  const done = new Promise((resolve) => child.on("exit", resolve));
  child.kill("SIGTERM");
  await done;
  assert.equal(existsSync(lockPath), false);
});

void test("the lock lives in the clone's git common directory, shared by its worktrees", (t) => {
  const { root } = scratch(t);
  const repo = path.join(root, "repo");
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  git(root, "init", "--quiet", repo);
  git(repo, "config", "user.email", "lock@example.test");
  git(repo, "config", "user.name", "Lock Test");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "Initial");
  const worktree = path.join(root, "session", "repo");
  git(repo, "worktree", "add", "--quiet", "--detach", worktree);

  const common = git(
    repo,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ).trim();
  assert.equal(defaultLockPath(repo), path.join(common, LOCK_FILE_NAME));
  assert.equal(defaultLockPath(worktree), defaultLockPath(repo));
});

void test("status names the holder and since when, and there is no way to force it", (t) => {
  const { lockPath } = scratch(t);
  assert.equal(productionLockStatus({ lockPath }).status, "free");
  const lock = acquireProductionLock("Updates publication", {
    lockPath,
    now: new Date("2026-01-15T18:30:00.000Z"),
  });
  t.after(() => lock.release());
  const status = productionLockStatus({ lockPath });
  assert.equal(status.status, "held");
  assert.equal(status.lock.purpose, "Updates publication");
  assert.equal(
    status.since,
    "2026-01-15 18:30:00 UTC (2026-01-15 12:30:00 CST)",
  );
  assert.equal(status.processGone, false);
  assert.equal("token" in status.lock, false);

  const source = readFileSync(
    path.join(ROOT, "scripts/production-lock.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /--force|clear-stale|clear-manual|breakLock/);
});

void test("every out-of-band production write takes the lock itself", () => {
  const read = (file) => readFileSync(path.join(ROOT, "scripts", file), "utf8");
  for (const file of ["referee-decide.mjs", "referee-ranked-access.mjs"]) {
    assert.match(read(file), /await withProductionLockOrFail\(/, file);
  }
  assert.match(
    read("_referee-lib.mjs"),
    /production_lock_held[\s\S]*finally \{\s*lock\.release\(\);/,
  );
  assert.match(
    read("run-reports.mjs"),
    /acquireProductionLock\([\s\S]*triageRunReport\(doc[\s\S]*finally \{\s*lock\.release\(\);/,
  );
  assert.match(
    read("player-updates.mjs"),
    /withProductionLock\(`Updates publication \$\{entry\.id\}`/,
  );
});
