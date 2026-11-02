#!/usr/bin/env node

// Read-only listing of stored run reports. Reports are counted on the Drop
// dashboard from the API's `run-report.received` log line; nobody triages
// them, so this script has no status write (retired 2026-11-02).

import { pathToFileURL } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const RUN_REPORTS_ROLE_NAME = "elixir-drop-run-reports";

const TABLE_NAME =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
const MAX_REPORTS = 500;

export function isExpectedRunReportsIdentity(identity) {
  const arn = typeof identity?.Arn === "string" ? identity.Arn : "";
  const account = typeof identity?.Account === "string" ? identity.Account : "";
  const match = arn.match(
    /^arn:(?:aws|aws-cn|aws-us-gov):sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/,
  );
  return Boolean(
    match && match[1] === account && match[2] === RUN_REPORTS_ROLE_NAME,
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
  if (!isExpectedRunReportsIdentity(identity))
    throw new Error(
      `AWS caller must be an assumed-role session for ${RUN_REPORTS_ROLE_NAME}`,
    );
  return documentClientFactory();
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags[name] = true;
    else {
      flags[name] = next;
      index += 1;
    }
  }
  return { positional, flags };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(reason, detail) {
  print({
    status: "insufficient_evidence",
    reason,
    ...(detail ? { detail } : {}),
  });
  process.exitCode = 1;
}

export function sanitizeRunReport(item) {
  return {
    reportId: item.reportId,
    runId: item.runId,
    runReference: item.runReference,
    mode: item.mode,
    firstReportedAt: item.firstReportedAt,
    lastReportedAt: item.lastReportedAt,
    reportCount: item.reportCount,
    failureCode: item.failureCode,
    failureStatus: item.failureStatus,
    clientBuildId: item.clientBuildId,
    clientOnline: item.clientOnline,
    clientVisibility: item.clientVisibility,
    clientDisplayMode: item.clientDisplayMode,
    runFound: item.runFound,
    runState: item.runState,
    guest: item.guest,
    runAgeSeconds: item.runAgeSeconds,
    ...(item.context ? { untrustedPlayerContext: item.context } : {}),
  };
}

export async function loadRunReports(doc, { since, limit }) {
  const reports = [];
  let lastKey;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :reportPrefix)",
        ExpressionAttributeValues: {
          ":pk": "RUN_REPORTS",
          ":reportPrefix": "REPORT#",
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    reports.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && reports.length < MAX_REPORTS);

  return reports
    .filter((report) => !since || Date.parse(report.lastReportedAt) >= since)
    .sort(
      (left, right) =>
        Date.parse(right.lastReportedAt) - Date.parse(left.lastReportedAt),
    )
    .slice(0, limit);
}

async function main(argv) {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region)
    return fail("no_aws_region", "Set AWS_REGION for the run-reports role");
  const { positional, flags } = parseFlags(argv);
  const command = positional[0] ?? "list";
  const doc = await createVerifiedDocumentClient({ region });

  if (command === "list") {
    const limit = flags.limit === undefined ? 100 : Number(flags.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REPORTS)
      return fail("invalid_limit", `--limit must be 1-${MAX_REPORTS}`);
    const since =
      flags.since === undefined
        ? Date.now() - 7 * 24 * 60 * 60 * 1_000
        : Date.parse(String(flags.since));
    if (!Number.isFinite(since))
      return fail("invalid_since", "--since must be an ISO timestamp");
    const reports = (await loadRunReports(doc, { since, limit })).map(
      sanitizeRunReport,
    );
    return print({
      status: "ok",
      since: new Date(since).toISOString(),
      count: reports.length,
      reports,
    });
  }

  return fail(
    "unknown_command",
    "Only list remains; run-report triage was retired on 2026-11-02",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) =>
    fail(
      "run_reports_failed",
      error instanceof Error ? error.message : "unknown",
    ),
  );
}
