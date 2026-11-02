import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createVerifiedDocumentClient,
  REFEREE_ROLE_NAME,
} from "./_referee-lib.mjs";
import {
  createVerifiedDocumentClient as createVerifiedRunReportsClient,
  RUN_REPORTS_ROLE_NAME,
  sanitizeRunReport,
} from "./run-reports.mjs";
import {
  fetchBugReports,
  isDeliveryCanary,
  sanitizeBugReportEmail,
} from "./mail-bug-reports.mjs";
import {
  entryFromFlags,
  listUpdates,
  PLAYER_UPDATES_USAGE,
  publishUpdate,
  resolveUpdatesPublishToken,
  updateId as playerUpdateId,
} from "./player-updates.mjs";
import {
  CLOUD_AUDITOR_ROLE_NAME,
  isExpectedCloudAuditorIdentity,
  summarizeWebActivity,
  WEB_ACTIVITY_QUERIES,
} from "./web-activity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

void test("player Updates CLI lists publicly and uses a bearer token to publish", async () => {
  assert.match(PLAYER_UPDATES_USAGE, /list \[--limit 1-500\] \[--json\]/);
  assert.match(
    PLAYER_UPDATES_USAGE,
    /publish --kind <feature\|season\|message>/,
  );
  assert.match(PLAYER_UPDATES_USAGE, /does not use AWS credentials/);
  assert.equal(
    playerUpdateId("Season 137: Higher / Lower!", new Date("2026-10-05Z")),
    "2026-10-05-season-137-higher-lower",
  );
  assert.equal(
    await resolveUpdatesPublishToken({
      environment: {
        ELIXIR_DROP_UPDATES_PUBLISH_TOKEN:
          "test-publisher-token-with-at-least-32-characters",
      },
    }),
    "test-publisher-token-with-at-least-32-characters",
  );
  assert.equal(
    await resolveUpdatesPublishToken({
      environment: {},
      readFileImpl: async () =>
        'ELIXIR_DROP_UPDATES_PUBLISH_TOKEN="fixed-host-token-with-at-least-32-characters"\n',
    }),
    "fixed-host-token-with-at-least-32-characters",
  );
  await assert.rejects(
    resolveUpdatesPublishToken({
      environment: {},
      readFileImpl: async () => "",
    }),
    /ELIXIR_DROP_UPDATES_PUBLISH_TOKEN/,
  );
  assert.deepEqual(
    entryFromFlags(
      {
        kind: "season",
        title: "Season 137 opens",
        body: "Higher / Lower leads the season.",
      },
      new Date("2026-10-05T12:00:00Z"),
    ),
    {
      id: "2026-10-05-season-137-opens",
      kind: "season",
      publishedAt: "2026-10-05T12:00:00.000Z",
      title: "Season 137 opens",
      body: "Higher / Lower leads the season.",
    },
  );

  const requests = [];
  const fetchImpl = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(
      JSON.stringify(
        init?.method === "POST"
          ? { created: true, entry: { id: "update" } }
          : { entries: [] },
      ),
      { status: init?.method === "POST" ? 201 : 200 },
    );
  };
  await listUpdates({
    limit: 20,
    baseUrl: "https://api.example",
    fetchImpl,
  });
  const token = "test-publisher-token-with-at-least-32-characters";
  await publishUpdate(
    { kind: "message", title: "Arena note", body: "A short note." },
    {
      baseUrl: "https://api.example",
      fetchImpl,
      token,
    },
  );
  assert.equal(requests[0].input, "https://api.example/updates?limit=20");
  assert.equal(requests[1].input, "https://api.example/admin/updates");
  assert.equal(requests[1].init.headers.authorization, `Bearer ${token}`);
  assert.equal(requests[1].init.headers.host, undefined);
});

void test("operator tooling lives in scripts/ and the Fair Play policy keeps its contract", () => {
  for (const script of ["production-lock.mjs", "worktree-setup.sh"]) {
    assert.notEqual(
      statSync(path.join(ROOT, "scripts", script)).mode & 0o111,
      0,
      script,
    );
  }
  assert.equal(existsSync(path.join(ROOT, "AGENT-TEAM")), false);
  assert.match(
    readFileSync(
      path.join(ROOT, ".codex/environments/environment.toml"),
      "utf8",
    ),
    /script = "bash scripts\/worktree-setup\.sh"/,
  );

  const operations = readFileSync(
    path.join(ROOT, "docs/OPERATIONS.md"),
    "utf8",
  );
  assert.deepEqual(
    [...operations.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    [
      "Health",
      "Cards",
      "Seasons",
      "Fair Play",
      "Player Updates",
      "Player reports",
    ],
  );
  assert.match(operations, /docs\/FAIR-PLAY\.md/);
  assert.match(operations, /production-lock\.mjs/);
  // The Free Pass Challenge was retired 2026-11-02: no designation, rotation
  // or recipient duty survives in the operating guide.
  assert.doesNotMatch(operations, /Free\s+Pass|free-pass-mode|designat/i);
  // Run-report triage was retired 2026-11-02: reports are dashboard counts,
  // so the guide gives nobody a queue to work.
  assert.doesNotMatch(
    operations,
    /run-reports\.mjs triage|--status investigating/,
  );
  assert.match(operations, /never resized, re-encoded, or\s+otherwise altered/);

  const fairPlayPolicy = readFileSync(
    path.join(ROOT, "docs/FAIR-PLAY.md"),
    "utf8",
  );
  assert.match(fairPlayPolicy, /Jamie-confirmed direct playtesting/);
  assert.match(fairPlayPolicy, /never a blanket exemption/);
  assert.match(fairPlayPolicy, /missing.*evidence remains fail-closed/s);
  assert.match(
    fairPlayPolicy,
    /Every run ranks on finishing and wears no seal/,
  );
  assert.match(fairPlayPolicy, /one player-visible\s+status is `Excluded`/);
  assert.doesNotMatch(fairPlayPolicy, /`Awaiting`|`Cleared`|provisionally/);
  assert.doesNotMatch(fairPlayPolicy, /🔎|✅|🚫|`Pending`|`Reviewed`/);
  // Routine review retired 2026-11-02: a flag is investigated by hand with the
  // run, player and decide scripts, with no coverage cohort or watermark.
  assert.doesNotMatch(fairPlayPolicy, /watermark|cohort|top 25/i);
  assert.match(fairPlayPolicy, /## Investigating a flag by hand/);
  assert.match(fairPlayPolicy, /drop@poapkings\.com/);
  for (const retired of ["season-brief.mjs", "referee-tags.mjs"])
    assert.equal(
      existsSync(path.join(ROOT, "scripts", retired)),
      false,
      retired,
    );
});

void test("player updates pass one material-impact notification bar", () => {
  const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const operations = readFileSync(
    path.join(ROOT, "docs/OPERATIONS.md"),
    "utf8",
  );

  for (const contract of [agents, operations]) {
    assert.match(contract, /player-updates\.mjs/);
    assert.match(contract, /notification bar/);
  }
  assert.match(agents, /An Update is a notification, not a changelog/);
  assert.match(agents, /Player-visible is not\s+sufficient/);
  assert.match(operations, /Silence is the\s+default/);
  assert.match(
    operations,
    /Publishing does\s+not require a source commit or deployment/,
  );
  assert.doesNotMatch(agents, /cut-release/);
});

void test("implementation spec names the committed card snapshot", () => {
  const spec = readFileSync(path.join(ROOT, "SPEC.md"), "utf8");
  const cards = JSON.parse(
    readFileSync(path.join(ROOT, "packages/game-data/cards.json"), "utf8"),
  );

  assert.match(spec, new RegExp("- `version`: `" + cards.version + "`"));
  assert.match(spec, new RegExp("- `count`: `" + cards.count + "`"));
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

void test("run-report output is identity-free and the script has no write", () => {
  const report = {
    pk: "RUN_REPORTS",
    sk: "REPORT#run-1",
    reportId: "report-1",
    runId: "run-1",
    runReference: "#DTEST",
    mode: "surge",
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

  // A report from before 2026-11-02 keeps its retired triage fields in the
  // table; the listing no longer projects them.
  const legacy = sanitizeRunReport({
    ...report,
    status: "investigating",
    lastTriagedAt: "2026-09-16T17:00:00.000Z",
    lastTriageNote: "Watching recurrence",
  });
  assert.equal("status" in legacy, false);
  assert.equal("triageNote" in legacy, false);
  assert.equal("lastTriagedAt" in legacy, false);

  // Triage is retired: the script lists and never writes.
  const source = readFileSync(
    new URL("./run-reports.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /TransactWriteCommand|UpdateCommand|PutCommand|DeleteCommand|acquireProductionLock/,
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
