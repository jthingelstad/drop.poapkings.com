import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLeaseOwner,
  claimLease,
  clearManualLease,
  clearStaleLease,
  releaseLease,
} from "../AGENT-TEAM/scripts/objective-lease.mjs";
import {
  createVerifiedDocumentClient,
  REFEREE_ROLE_NAME,
} from "../AGENT-TEAM/scripts/_referee-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFLIGHT = path.join(ROOT, "AGENT-TEAM/scripts/preflight.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

function repositoryFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "drop-agent-team-"));
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--bare", remote);
  git(root, "init", repo);
  git(repo, "config", "user.email", "agent-team@example.test");
  git(repo, "config", "user.name", "Agent Team Test");
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "Initial");
  git(repo, "branch", "-M", "main");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  return { remote, repo, root };
}

function preflight(repo) {
  return spawnSync("bash", [PREFLIGHT], { cwd: repo, encoding: "utf8" });
}

function pushRemoteCommit(root, remote, name) {
  const writer = path.join(root, `writer-${name}`);
  git(root, "clone", "--branch", "main", remote, writer);
  git(writer, "config", "user.email", "agent-team@example.test");
  git(writer, "config", "user.name", "Agent Team Test");
  writeFileSync(path.join(writer, `${name}.txt`), `${name}\n`);
  git(writer, "add", `${name}.txt`);
  git(writer, "commit", "-m", name);
  git(writer, "push", "origin", "main");
}

void test("objective lease is atomic, private, and owner-scoped", (t) => {
  const { repo, root } = repositoryFixture(t);
  const leasePath = path.join(root, "lease.json");
  const startingHead = git(repo, "rev-parse", "HEAD").trim();

  const claimed = claimLease("run", {
    leasePath,
    repoRoot: repo,
    leaseId: "lease-run-1",
    now: new Date("2026-08-12T12:00:00.000Z"),
    holderId: "thread-1",
    holderPid: 4242,
    hostname: "test-host",
    startingHead,
  });
  assert.deepEqual(claimed, {
    objective: "run",
    leaseId: "lease-run-1",
    claimedAt: "2026-08-12T12:00:00.000Z",
    holderId: "thread-1",
    holderPid: 4242,
    hostname: "test-host",
    startingHead,
  });
  assert.equal(statSync(leasePath).mode & 0o777, 0o600);
  assert.throws(() => claimLease("grow", { leasePath }), /already held/);
  assert.throws(
    () => assertLeaseOwner("run", "another-run", leasePath),
    /another run/,
  );
  assert.throws(
    () => releaseLease("run", "another-run", leasePath, repo),
    /another run/,
  );
  assert.deepEqual(
    releaseLease("run", "lease-run-1", leasePath, repo),
    claimed,
  );
  assert.equal(releaseLease("run", "lease-run-1", leasePath, repo), null);
});

void test("stale clearing requires age plus proof that the holder is inactive", (t) => {
  const { repo, root } = repositoryFixture(t);
  const leasePath = path.join(root, "lease.json");
  const startingHead = git(repo, "rev-parse", "HEAD").trim();
  claimLease("grow", {
    leasePath,
    repoRoot: repo,
    leaseId: "lease-grow-1",
    now: new Date("2026-08-12T00:00:00.000Z"),
    holderId: "thread-2",
    holderPid: 4242,
    hostname: "test-host",
    startingHead,
  });
  assert.throws(
    () =>
      clearStaleLease({
        leasePath,
        repoRoot: repo,
        hours: 8,
        now: new Date("2026-08-12T07:59:00.000Z"),
      }),
    /not yet 8 hours old/,
  );
  writeFileSync(path.join(repo, "dirty.txt"), "dirty\n");
  assert.throws(
    () =>
      clearStaleLease({
        leasePath,
        repoRoot: repo,
        hours: 8,
        now: new Date("2026-08-12T09:00:00.000Z"),
        hostname: "test-host",
        processExists: () => false,
      }),
    /worktree is dirty/,
  );
  rmSync(path.join(repo, "dirty.txt"));
  assert.throws(
    () =>
      clearStaleLease({
        leasePath,
        repoRoot: repo,
        hours: 8,
        now: new Date("2026-08-12T09:00:00.000Z"),
        hostname: "test-host",
        processExists: () => true,
      }),
    /still active/,
  );
  const cleared = clearStaleLease({
    leasePath,
    repoRoot: repo,
    hours: 8,
    now: new Date("2026-08-12T09:00:00.000Z"),
    hostname: "test-host",
    processExists: () => false,
  });
  assert.equal(cleared.leaseId, "lease-grow-1");
});

void test("manual clearing requires exact holder confirmation and a clean tree", (t) => {
  const { repo, root } = repositoryFixture(t);
  const leasePath = path.join(root, "lease.json");
  claimLease("fair-play", {
    leasePath,
    repoRoot: repo,
    leaseId: "lease-fair-play-1",
    holderId: "thread-3",
  });
  assert.throws(
    () => clearManualLease({ leasePath, repoRoot: repo }),
    /confirm-inactive/,
  );
  assert.throws(
    () =>
      clearManualLease({
        leasePath,
        repoRoot: repo,
        holderId: "another-thread",
        confirmInactive: true,
      }),
    /lease holder/,
  );
  const cleared = clearManualLease({
    leasePath,
    repoRoot: repo,
    holderId: "thread-3",
    confirmInactive: true,
  });
  assert.equal(cleared.leaseId, "lease-fair-play-1");
});

void test("preflight passes only for a clean synchronized branch", (t) => {
  const { repo } = repositoryFixture(t);
  const result = preflight(repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /clean and in sync/);
});

void test("preflight fails for every unsafe publication state", async (t) => {
  await t.test("dirty", (t) => {
    const { repo } = repositoryFixture(t);
    writeFileSync(path.join(repo, "dirty.txt"), "dirty\n");
    assert.notEqual(preflight(repo).status, 0);
  });
  await t.test("ahead", (t) => {
    const { repo } = repositoryFixture(t);
    writeFileSync(path.join(repo, "ahead.txt"), "ahead\n");
    git(repo, "add", "ahead.txt");
    git(repo, "commit", "-m", "Ahead");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /AHEAD/);
  });
  await t.test("behind", (t) => {
    const { remote, repo, root } = repositoryFixture(t);
    pushRemoteCommit(root, remote, "behind");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /BEHIND/);
  });
  await t.test("diverged", (t) => {
    const { remote, repo, root } = repositoryFixture(t);
    writeFileSync(path.join(repo, "local.txt"), "local\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-m", "Local");
    pushRemoteCommit(root, remote, "remote");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /DIVERGED/);
  });
  await t.test("detached", (t) => {
    const { repo } = repositoryFixture(t);
    git(repo, "checkout", "--detach", "HEAD");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /DETACHED/);
  });
  await t.test("non-main branch", (t) => {
    const { repo } = repositoryFixture(t);
    git(repo, "checkout", "-b", "feature");
    git(repo, "push", "-u", "origin", "feature");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /only from main/);
  });
  await t.test("missing upstream", (t) => {
    const { repo } = repositoryFixture(t);
    git(repo, "branch", "--unset-upstream");
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /no upstream/);
  });
  await t.test("fetch failed", (t) => {
    const { repo, root } = repositoryFixture(t);
    git(repo, "remote", "set-url", "origin", path.join(root, "missing.git"));
    const result = preflight(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /fetch origin failed/);
  });
});

void test("automation registry contains exactly the three active objective owners", () => {
  const source = readFileSync(
    path.join(ROOT, "AGENT-TEAM/automations.toml"),
    "utf8",
  );
  assert.match(source, /^repo = "\."$/m);
  const entries = source
    .split("[[automation]]")
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        [...block.matchAll(/^(\w+) = "([^"]+)"$/gm)].map((m) => [m[1], m[2]]),
      ),
    );
  assert.deepEqual(entries.map((entry) => entry.objective).sort(), [
    "fair-play",
    "grow",
    "run",
  ]);
  const expectedSchedules = {
    "fair-play": "RRULE:FREQ=DAILY;BYHOUR=18;BYMINUTE=30",
    grow: "RRULE:FREQ=DAILY;BYHOUR=12;BYMINUTE=30",
    run: "RRULE:FREQ=DAILY;BYHOUR=10;BYMINUTE=30",
  };
  for (const entry of entries) {
    assert.equal(entry.status, "ACTIVE");
    assert.equal(entry.rrule, expectedSchedules[entry.objective]);
    assert.doesNotThrow(() =>
      readFileSync(path.join(ROOT, entry.objective_file), "utf8"),
    );
  }
  assert.notEqual(
    statSync(path.join(ROOT, "AGENT-TEAM/scripts/objective-lease.mjs")).mode &
      0o111,
    0,
  );
});

void test("objective contract requires the lease and contains no retired queue labels", () => {
  const workflow = readFileSync(
    path.join(ROOT, "AGENT-TEAM/WORKFLOW.md"),
    "utf8",
  );
  const readme = readFileSync(path.join(ROOT, "AGENT-TEAM/README.md"), "utf8");
  const setup = readFileSync(
    path.join(ROOT, "AGENT-TEAM/scripts/setup-labels.sh"),
    "utf8",
  );
  assert.match(workflow, /objective-lease\.mjs claim/);
  assert.match(workflow, /Only when a safe authorized gap requires mutation/);
  assert.match(workflow, /release <objective> <leaseId>/);
  assert.match(
    workflow,
    /Outcome: HEALTHY \| CHANGED \| WATCHING \| BLOCKED \| NEEDS JAMIE/,
  );
  assert.match(
    readme,
    /Run <objective> now and own the highest-impact measured gap\./,
  );
  assert.match(
    setup,
    /approved needs-deploy needs-design proposal ready release wip/,
  );
  assert.doesNotMatch(
    setup,
    /upsert "(?:approved|needs-deploy|needs-design|proposal|ready|release|wip)"/,
  );
  const fairPlay = readFileSync(
    path.join(ROOT, "AGENT-TEAM/protect-fair-play.md"),
    "utf8",
  );
  assert.match(fairPlay, /fair-play-policy\.md/);
  const fairPlayPolicy = readFileSync(
    path.join(ROOT, "AGENT-TEAM/fair-play-policy.md"),
    "utf8",
  );
  assert.match(fairPlayPolicy, /Jamie-confirmed direct playtesting/);
  assert.match(fairPlayPolicy, /never a blanket exemption/);
  assert.match(fairPlayPolicy, /missing.*evidence remains fail-closed/s);
});

void test("automation registry passes the common contract audit", () => {
  const result = spawnSync(
    "python3",
    ["AGENT-TEAM/scripts/automation_audit.py", "--registry-only"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK\s+registry\s+3 objective owners/);
});

void test("referee data clients require the bounded assumed role", async () => {
  let dataClientCreated = false;
  const createDataClient = () => {
    dataClientCreated = true;
    return { verified: true };
  };

  await assert.rejects(
    createVerifiedDocumentClient({
      region: "us-east-1",
      identityClient: {
        send: async () => ({
          Account: "999153317627",
          Arn: "arn:aws:iam::999153317627:user/deploy",
        }),
      },
      documentClientFactory: createDataClient,
    }),
    new RegExp(`assumed-role session for ${REFEREE_ROLE_NAME}`),
  );
  assert.equal(dataClientCreated, false);

  const dataClient = await createVerifiedDocumentClient({
    region: "us-east-1",
    identityClient: {
      send: async (command) => {
        assert.equal(command.constructor.name, "GetCallerIdentityCommand");
        return {
          Account: "999153317627",
          Arn: `arn:aws:sts::999153317627:assumed-role/${REFEREE_ROLE_NAME}/test-session`,
        };
      },
    },
    documentClientFactory: createDataClient,
  });
  assert.deepEqual(dataClient, { verified: true });
  assert.equal(dataClientCreated, true);
});
