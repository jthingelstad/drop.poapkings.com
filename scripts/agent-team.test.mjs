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
  OBJECTIVES,
  releaseLease,
} from "../AGENT-TEAM/scripts/objective-lease.mjs";
import {
  buildSeasonBrief,
  RANKED_MODES as RANKED_MODE_FIXTURES,
} from "../AGENT-TEAM/scripts/season-brief.mjs";
import {
  createVerifiedDocumentClient,
  REFEREE_ROLE_NAME,
} from "../AGENT-TEAM/scripts/_referee-lib.mjs";
import {
  createVerifiedDocumentClient as createVerifiedRunReportsClient,
  RUN_REPORTS_ROLE_NAME,
  sanitizeRunReport,
  triageRunReport,
} from "../AGENT-TEAM/scripts/run-reports.mjs";
import {
  fetchBugReports,
  isDeliveryCanary,
  sanitizeBugReportEmail,
} from "../AGENT-TEAM/scripts/mail-bug-reports.mjs";
import {
  CLOUD_AUDITOR_ROLE_NAME,
  isExpectedCloudAuditorIdentity,
  summarizeWebActivity,
  WEB_ACTIVITY_QUERIES,
} from "./web-activity.mjs";

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

void test("automation registry contains exactly the five active objective owners", () => {
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
    "improve",
    "run",
    "season",
  ]);
  const expectedSchedules = {
    "fair-play": "RRULE:FREQ=DAILY;BYHOUR=18;BYMINUTE=30",
    grow: "RRULE:FREQ=DAILY;BYHOUR=12;BYMINUTE=30",
    improve: "RRULE:FREQ=WEEKLY;BYDAY=WE;BYHOUR=14;BYMINUTE=30",
    run: "RRULE:FREQ=DAILY;BYHOUR=10;BYMINUTE=30",
    season: "RRULE:FREQ=DAILY;BYHOUR=19;BYMINUTE=30",
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
  assert.notEqual(
    statSync(path.join(ROOT, "AGENT-TEAM/scripts/season-brief.mjs")).mode &
      0o111,
    0,
  );
  assert.deepEqual([...OBJECTIVES].sort(), [
    "fair-play",
    "grow",
    "improve",
    "run",
    "season",
  ]);
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
  assert.match(
    fairPlayPolicy,
    /`Awaiting`, `Cleared`, and `Excluded`.*Awaiting run ranks\s+provisionally/s,
  );
  assert.doesNotMatch(fairPlayPolicy, /🔎|✅|🚫|`Pending`|`Reviewed`/);
  const improve = readFileSync(
    path.join(ROOT, "AGENT-TEAM/improve-drop.md"),
    "utf8",
  );
  assert.match(improve, /quality of the experience once a player reaches Drop/);
  assert.match(improve, /directly reproducible.*is evidence/s);
  const season = readFileSync(
    path.join(ROOT, "AGENT-TEAM/call-the-season.md"),
    "utf8",
  );
  assert.match(
    season,
    /Surge is the current designated game and\s+Rain is next/,
  );
  assert.match(season, /winning run is Cleared/);
  assert.match(
    season,
    /ask Jamie one yes\/no question before naming the recipient/,
  );
  assert.match(season, /Home Free Pass hero name and open that same game/);
});

void test("season brief contains all five public boards and strips identity fields", async () => {
  assert.deepEqual(RANKED_MODE_FIXTURES, [
    "surge",
    "higher-lower",
    "trade",
    "survival",
    "rain",
  ]);
  const season = {
    id: 136,
    startsAt: "2026-09-07T09:00:00.000Z",
    endsAt: "2026-10-05T09:00:00.000Z",
    durationWeeks: 4,
  };
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/seasons") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ current: season, upcoming: [] }),
      };
    }
    const mode = url.searchParams.get("mode");
    assert.ok(RANKED_MODE_FIXTURES.includes(mode));
    assert.equal(url.searchParams.get("season"), String(season.id));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        mode,
        scope: "season",
        seasonId: season.id,
        entries: [
          {
            rank: 1,
            score: mode === "surge" ? 12.345 : 21,
            achievedAt: "2026-09-10T12:00:00.000Z",
            reviewStatus: mode === "rain" ? "pending" : "reviewed",
            player: {
              id: `private-${mode}`,
              publicName: `${mode} leader`,
              playerTag: "#PRIVATE",
              email: "private@example.test",
            },
          },
        ],
      }),
    };
  };

  const brief = await buildSeasonBrief({
    apiBaseUrl: "https://drop.example.test",
    fetchImpl,
    freePassMode: "rain",
    now: new Date("2026-09-10T13:00:00.000Z"),
  });
  assert.equal(brief.status, "ok");
  assert.equal(brief.freePassMode, "rain");
  assert.equal(brief.season.phase, "active");
  assert.deepEqual(
    brief.boards.map((board) => board.mode),
    RANKED_MODE_FIXTURES,
  );
  assert.equal(brief.boards.at(-1).leader.reviewStatus, "Awaiting");
  assert.equal(brief.boards.at(-1).leader.finalEligible, false);
  const serialized = JSON.stringify(brief);
  assert.doesNotMatch(
    serialized,
    /private-|#PRIVATE|private@example|playerTag/,
  );
});

void test("player updates pass one material-impact notification bar", () => {
  const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
  const workflow = readFileSync(
    path.join(ROOT, "AGENT-TEAM/WORKFLOW.md"),
    "utf8",
  );
  const improve = readFileSync(
    path.join(ROOT, "AGENT-TEAM/improve-drop.md"),
    "utf8",
  );
  const grow = readFileSync(path.join(ROOT, "AGENT-TEAM/grow-drop.md"), "utf8");
  const season = readFileSync(
    path.join(ROOT, "AGENT-TEAM/call-the-season.md"),
    "utf8",
  );

  for (const contract of [agents, workflow, grow]) {
    assert.match(contract, /data\/updates\/features\.json/);
    assert.match(contract, /notification bar/);
  }
  assert.match(claude, /An Update is a notification, not a changelog/);
  assert.match(claude, /Player-visible is not\s+sufficient/);
  assert.match(workflow, /Player-visible is not\s+sufficient/);
  assert.match(improve, /most polish\s+should ship quietly/);
  assert.match(grow, /first run of each calendar week/);
  assert.match(grow, /Silence is the\s+healthy default/);
  assert.doesNotMatch(workflow, /visible behavior/);
  assert.doesNotMatch(season, /still holding/);
  assert.match(grow, /seasons\.json/);
  assert.match(grow, /messages\.json/);
  assert.doesNotMatch(agents, /cut-release/);
});

void test("automation registry passes the common contract audit", () => {
  const result = spawnSync(
    "python3",
    ["AGENT-TEAM/scripts/automation_audit.py", "--registry-only"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK\s+registry\s+5 objective owners/);
});

void test("browser CI uses the version-matched Playwright image", () => {
  const packageLock = JSON.parse(
    readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
  );
  const playwrightVersion =
    packageLock.packages["node_modules/@playwright/test"].version;
  const expectedImage = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

  for (const workflowPath of [
    ".github/workflows/validate-main.yml",
    ".github/workflows/verify.yml",
  ]) {
    const workflow = readFileSync(path.join(ROOT, workflowPath), "utf8");
    assert.match(workflow, new RegExp(`image: ${expectedImage}`));
    assert.doesNotMatch(workflow, /playwright install --with-deps/);
  }
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

void test("run-report clients require their separate bounded assumed role", async () => {
  let dataClientCreated = false;
  const createDataClient = () => {
    dataClientCreated = true;
    return { verified: true };
  };

  await assert.rejects(
    createVerifiedRunReportsClient({
      region: "us-east-1",
      identityClient: {
        send: async () => ({
          Account: "999153317627",
          Arn: "arn:aws:iam::999153317627:user/elixir-drop",
        }),
      },
      documentClientFactory: createDataClient,
    }),
    new RegExp(`assumed-role session for ${RUN_REPORTS_ROLE_NAME}`),
  );
  assert.equal(dataClientCreated, false);

  const dataClient = await createVerifiedRunReportsClient({
    region: "us-east-1",
    identityClient: {
      send: async () => ({
        Account: "999153317627",
        Arn: `arn:aws:sts::999153317627:assumed-role/${RUN_REPORTS_ROLE_NAME}/test-session`,
      }),
    },
    documentClientFactory: createDataClient,
  });
  assert.deepEqual(dataClient, { verified: true });
  assert.equal(dataClientCreated, true);
});

void test("web activity reporting requires the read-only cloud auditor and stays aggregate", () => {
  assert.equal(
    isExpectedCloudAuditorIdentity({
      Account: "999153317627",
      Arn: `arn:aws:sts::999153317627:assumed-role/${CLOUD_AUDITOR_ROLE_NAME}/test-session`,
    }),
    true,
  );
  assert.equal(
    isExpectedCloudAuditorIdentity({
      Account: "999153317627",
      Arn: "arn:aws:iam::999153317627:user/jamie",
    }),
    false,
  );
  assert.equal(
    isExpectedCloudAuditorIdentity({
      Account: "999153317627",
      Arn: "arn:aws:sts::999153317627:assumed-role/AnotherRole/session",
    }),
    false,
  );

  const result = (row) => ({
    results: [
      Object.entries(row).map(([field, value]) => ({
        field,
        value: String(value),
      })),
    ],
  });
  const summary = summarizeWebActivity(
    {
      overview: result({
        requests: 12,
        responseBytes: 4096,
        p95Ttfb: 0.08,
        maxTtfb: 0.2,
      }),
      statuses: result({ status: 200, requests: 11 }),
      requestClasses: result({
        requestClass: "web-home",
        requests: 8,
        responseBytes: 2048,
        p95Ttfb: 0.05,
      }),
      cacheOutcomes: result({ cacheOutcome: "Hit", requests: 10 }),
      errors: result({
        status: 404,
        requestClass: "web-other",
        detail: "Error",
        requests: 1,
      }),
    },
    {
      hours: 24,
      start: "2026-08-21T14:00:00.000Z",
      end: "2026-08-22T14:00:00.000Z",
    },
  );
  assert.equal(summary.status, "ok");
  assert.equal(summary.requests, 12);
  assert.deepEqual(summary.errors, [
    {
      status: "404",
      requestClass: "web-other",
      detail: "Error",
      requests: 1,
    },
  ]);

  const queries = JSON.stringify(Object.values(WEB_ACTIVITY_QUERIES));
  assert.doesNotMatch(
    queries,
    /c-ip|User-Agent|uri-stem|Referer|Cookie|requestId/i,
  );
  assert.match(WEB_ACTIVITY_QUERIES.overview, /`sc-bytes` as bytes/);
  assert.doesNotMatch(
    WEB_ACTIVITY_QUERIES.overview,
    /fields .* as responseBytes/,
  );
  for (const query of Object.values(WEB_ACTIVITY_QUERIES)) {
    assert.match(query, /filter ispresent\(status\)/);
  }
});

void test("run-report output is identity-free and triage writes one immutable audit", async () => {
  const report = {
    pk: "RUN_REPORTS",
    sk: "REPORT#run-1",
    reportId: "report-1",
    runId: "run-1",
    runReference: "#DTEST",
    mode: "surge",
    status: "new",
    firstReportedAt: "2026-08-21T20:00:00.000Z",
    lastReportedAt: "2026-08-21T20:00:00.000Z",
    reportCount: 1,
    failureCode: "run_expired",
    failureStatus: 410,
    clientBuildId: "build-1",
    clientOnline: true,
    clientVisibility: "visible",
    clientDisplayMode: "browser",
    runFound: true,
    runState: "started",
    guest: false,
    runAgeSeconds: 3_602,
    context: "The final button froze.",
    expiresAt: 1_800_000_000,
  };
  const output = sanitizeRunReport(report);
  assert.equal(output.untrustedPlayerContext, "The final button froze.");
  assert.equal("pk" in output, false);
  assert.equal("sk" in output, false);
  assert.equal("expiresAt" in output, false);

  let command;
  const doc = {
    send: async (value) => {
      command = value;
      return {};
    },
  };
  const updated = await triageRunReport(doc, report, {
    nextStatus: "investigating",
    note: "Reproducing the terminal completion failure",
    now: new Date("2026-08-21T21:00:00.000Z"),
    auditId: "audit-1",
  });
  assert.equal(updated.status, "investigating");
  assert.deepEqual(
    command.input.TransactItems.map((item) =>
      item.Update ? item.Update.Key.pk : item.Put.Item.pk,
    ),
    ["RUN_REPORTS", "RUN_REPORTS"],
  );
  assert.equal(
    command.input.TransactItems[1].Put.Item.sk,
    "AUDIT#report-1#2026-08-21T21:00:00.000Z#audit-1",
  );
});

void test("Fastmail bug intake excludes canaries and redacts contact addresses", async () => {
  const canary = {
    id: "canary-1",
    subject: "Elixir Drop mail canary 2026-08-21",
    from: [{ email: "elixir@poapkings.com" }],
  };
  assert.equal(isDeliveryCanary(canary), true);
  const sanitized = sanitizeBugReportEmail({
    id: "mail-1",
    receivedAt: "2026-08-21T20:00:00.000Z",
    subject: "Cannot finish Surge",
    from: [{ email: "player@example.test" }],
    preview: "Please reply to player@example.test. The last button froze.",
  });
  assert.deepEqual(sanitized, {
    messageId: "mail-1",
    receivedAt: "2026-08-21T20:00:00.000Z",
    subject: "Cannot finish Surge",
    senderDomain: "example.test",
    untrustedReportText:
      "Please reply to [email redacted]. The last button froze.",
  });

  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/jmap/session"))
      return {
        ok: true,
        json: async () => ({
          apiUrl: "https://api.fastmail.test/jmap/api/",
          primaryAccounts: { "urn:ietf:params:jmap:mail": "account-1" },
        }),
      };
    return {
      ok: true,
      json: async () => ({
        methodResponses: [
          ["Email/query", { ids: ["canary-1", "mail-1"] }, "query"],
          [
            "Email/get",
            {
              list: [
                { ...canary, to: [{ email: "drop@poapkings.com" }] },
                {
                  id: "mail-1",
                  receivedAt: "2026-08-21T20:00:00.000Z",
                  from: [{ email: "player@example.test" }],
                  to: [{ email: "drop@poapkings.com" }],
                  subject: "Cannot finish Surge",
                  preview: "The last button froze.",
                },
              ],
            },
            "get",
          ],
        ],
      }),
    };
  };
  const reports = await fetchBugReports({
    token: "test-token",
    since: Date.parse("2026-08-01T00:00:00.000Z"),
    fetchImpl,
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].messageId, "mail-1");
  const jmapBody = JSON.parse(requests[1].init.body);
  assert.deepEqual(
    jmapBody.methodCalls.map((call) => call[0]),
    ["Email/query", "Email/get"],
  );
  assert.doesNotMatch(requests[1].init.body, /Email\/set/);
});
