#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

export const RUN_REPORTS_ROLE_NAME = "elixir-drop-run-reports";
export const RUN_REPORT_STATUSES = new Set([
  "new",
  "investigating",
  "resolved",
  "dismissed",
]);

const TABLE_NAME =
  process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
const MAX_REPORTS = 500;
const MAX_NOTE_LENGTH = 500;

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
    status: item.status,
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
    ...(item.lastTriagedAt ? { lastTriagedAt: item.lastTriagedAt } : {}),
    ...(item.lastTriageNote ? { triageNote: item.lastTriageNote } : {}),
  };
}

export async function loadRunReports(doc, { since, status, limit }) {
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
    .filter(
      (report) =>
        (!since || Date.parse(report.lastReportedAt) >= since) &&
        (!status || report.status === status),
    )
    .sort(
      (left, right) =>
        Date.parse(right.lastReportedAt) - Date.parse(left.lastReportedAt),
    )
    .slice(0, limit);
}

function resolveReport(reports, identifier) {
  const normalized = identifier.toUpperCase();
  const matches = reports.filter(
    (report) =>
      report.runId === identifier ||
      report.reportId === identifier ||
      String(report.runReference).toUpperCase() === normalized,
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length ? "Report reference is ambiguous" : "Report not found",
    );
  return matches[0];
}

export async function triageRunReport(
  doc,
  report,
  { nextStatus, note, now = new Date(), auditId = randomUUID() },
) {
  const triagedAt = now.toISOString();
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { pk: "RUN_REPORTS", sk: `REPORT#${report.runId}` },
            UpdateExpression:
              "SET #status = :nextStatus, lastTriagedAt = :triagedAt, lastTriageNote = :note",
            ConditionExpression:
              "reportId = :reportId AND #status = :previousStatus",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":nextStatus": nextStatus,
              ":previousStatus": report.status,
              ":reportId": report.reportId,
              ":triagedAt": triagedAt,
              ":note": note,
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: "RUN_REPORTS",
              sk: `AUDIT#${report.reportId}#${triagedAt}#${auditId}`,
              reportId: report.reportId,
              runId: report.runId,
              runReference: report.runReference,
              previousStatus: report.status,
              status: nextStatus,
              note,
              triagedAt,
              triagedBy: "run-drop",
              expiresAt: report.expiresAt,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ],
    }),
  );
  return { ...report, status: nextStatus, lastTriagedAt: triagedAt };
}

async function main(argv) {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) return fail("no_aws_region", "Set AWS_REGION for Run Drop");
  const { positional, flags } = parseFlags(argv);
  const command = positional[0] ?? "list";
  const doc = await createVerifiedDocumentClient({ region });

  if (command === "list") {
    const limit = flags.limit === undefined ? 100 : Number(flags.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REPORTS)
      return fail("invalid_limit", `--limit must be 1-${MAX_REPORTS}`);
    const status = flags.status;
    if (status && (status === true || !RUN_REPORT_STATUSES.has(status)))
      return fail("invalid_status", "Choose a documented report status");
    const since =
      flags.since === undefined
        ? Date.now() - 7 * 24 * 60 * 60 * 1_000
        : Date.parse(String(flags.since));
    if (!Number.isFinite(since))
      return fail("invalid_since", "--since must be an ISO timestamp");
    const reports = (await loadRunReports(doc, { since, status, limit })).map(
      sanitizeRunReport,
    );
    return print({
      status: "ok",
      since: new Date(since).toISOString(),
      count: reports.length,
      reports,
    });
  }

  if (command === "triage") {
    const identifier = positional[1];
    const nextStatus = flags.status;
    const note = typeof flags.note === "string" ? flags.note.trim() : "";
    if (!identifier || !nextStatus || nextStatus === true || !note)
      return fail(
        "invalid_triage",
        "usage: run-reports.mjs triage <run-id-or-reference> --status investigating|resolved|dismissed --note <text>",
      );
    if (!["investigating", "resolved", "dismissed"].includes(nextStatus))
      return fail("invalid_status", "Triage cannot set status to new");
    if (note.length > MAX_NOTE_LENGTH)
      return fail(
        "invalid_note",
        `--note must be ${MAX_NOTE_LENGTH} characters or fewer`,
      );
    const reports = await loadRunReports(doc, {
      since: undefined,
      status: undefined,
      limit: MAX_REPORTS,
    });
    const report = resolveReport(reports, identifier);
    const updated = await triageRunReport(doc, report, {
      nextStatus,
      note,
    });
    return print({ status: "ok", report: sanitizeRunReport(updated) });
  }

  return fail("unknown_command", "Choose list or triage");
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
