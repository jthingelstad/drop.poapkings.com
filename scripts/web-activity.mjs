#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const CLOUD_AUDITOR_ROLE_NAME = "ProjectsMaintenanceReadOnly";
export const WEB_ACCESS_LOG_GROUP = "/elixir-drop/web-access";
export const WEB_ACCESS_LOG_RETENTION_DAYS = 14;
export const WEB_ACCESS_DELIVERY_NAME = "elixir-drop-web-access";

const MAX_HOURS = WEB_ACCESS_LOG_RETENTION_DAYS * 24;
const QUERY_TIMEOUT_ATTEMPTS = 60;

export const WEB_ACTIVITY_QUERIES = Object.freeze({
  overview: [
    "fields `sc-bytes` as bytes, `time-to-first-byte` as ttfb",
    "| stats count(*) as requests, sum(bytes) as responseBytes, pct(ttfb, 95) as p95Ttfb, max(ttfb) as maxTtfb",
  ].join("\n"),
  statuses: [
    "fields `sc-status` as status",
    "| stats count(*) as requests by status",
    "| sort requests desc",
  ].join("\n"),
  requestClasses: [
    "fields `viewer-request-log-data` as requestClass, `sc-bytes` as bytes, `time-to-first-byte` as ttfb",
    "| stats count(*) as requests, sum(bytes) as responseBytes, pct(ttfb, 95) as p95Ttfb by requestClass",
    "| sort requests desc",
  ].join("\n"),
  cacheOutcomes: [
    "fields `x-edge-response-result-type` as cacheOutcome",
    "| stats count(*) as requests by cacheOutcome",
    "| sort requests desc",
  ].join("\n"),
  errors: [
    "fields `sc-status` as status, `viewer-request-log-data` as requestClass, `x-edge-detailed-result-type` as detail",
    "| filter status >= 400",
    "| stats count(*) as requests by status, requestClass, detail",
    "| sort requests desc",
    "| limit 50",
  ].join("\n"),
});

export function isExpectedCloudAuditorIdentity(identity) {
  const arn = typeof identity?.Arn === "string" ? identity.Arn : "";
  const account = typeof identity?.Account === "string" ? identity.Account : "";
  const match = arn.match(
    /^arn:(?:aws|aws-cn|aws-us-gov):sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/,
  );
  return Boolean(
    match && match[1] === account && match[2] === CLOUD_AUDITOR_ROLE_NAME,
  );
}

export function rowsFromQueryResult(result) {
  return (result?.results ?? []).map((fields) =>
    Object.fromEntries(fields.map(({ field, value }) => [field, value])),
  );
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeWebActivity(queryResults, window) {
  const overview = rowsFromQueryResult(queryResults.overview)[0] ?? {};
  const requests = numberOrZero(overview.requests);
  return {
    status: requests > 0 ? "ok" : "no_activity",
    window,
    requests,
    responseBytes: numberOrZero(overview.responseBytes),
    p95TtfbSeconds: numberOrZero(overview.p95Ttfb),
    maxTtfbSeconds: numberOrZero(overview.maxTtfb),
    statuses: rowsFromQueryResult(queryResults.statuses).map((row) => ({
      status: row.status,
      requests: numberOrZero(row.requests),
    })),
    requestClasses: rowsFromQueryResult(queryResults.requestClasses).map(
      (row) => ({
        requestClass: row.requestClass || "unclassified",
        requests: numberOrZero(row.requests),
        responseBytes: numberOrZero(row.responseBytes),
        p95TtfbSeconds: numberOrZero(row.p95Ttfb),
      }),
    ),
    cacheOutcomes: rowsFromQueryResult(queryResults.cacheOutcomes).map(
      (row) => ({
        outcome: row.cacheOutcome || "unknown",
        requests: numberOrZero(row.requests),
      }),
    ),
    errors: rowsFromQueryResult(queryResults.errors).map((row) => ({
      status: row.status,
      requestClass: row.requestClass || "unclassified",
      detail: row.detail || "unknown",
      requests: numberOrZero(row.requests),
    })),
  };
}

function parseHours(argv) {
  const index = argv.indexOf("--hours");
  if (index === -1) return 24;
  const hours = Number(argv[index + 1]);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS)
    throw new Error(`--hours must be an integer from 1 to ${MAX_HOURS}`);
  return hours;
}

async function awsJson(args) {
  const { stdout } = await execFileAsync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function verifyAccessPath() {
  const identity = await awsJson(["sts", "get-caller-identity"]);
  if (!isExpectedCloudAuditorIdentity(identity))
    throw new Error(
      `AWS caller must be an assumed-role session for ${CLOUD_AUDITOR_ROLE_NAME}`,
    );

  const [groups, sources, destinations, deliveries] = await Promise.all([
    awsJson([
      "logs",
      "describe-log-groups",
      "--log-group-name-prefix",
      WEB_ACCESS_LOG_GROUP,
    ]),
    awsJson(["logs", "describe-delivery-sources"]),
    awsJson(["logs", "describe-delivery-destinations"]),
    awsJson(["logs", "describe-deliveries"]),
  ]);

  const group = groups.logGroups?.find(
    ({ logGroupName }) => logGroupName === WEB_ACCESS_LOG_GROUP,
  );
  if (!group) throw new Error(`${WEB_ACCESS_LOG_GROUP} does not exist`);
  if (group.retentionInDays !== WEB_ACCESS_LOG_RETENTION_DAYS)
    throw new Error(
      `${WEB_ACCESS_LOG_GROUP} retention is ${group.retentionInDays ?? "unbounded"} days; expected ${WEB_ACCESS_LOG_RETENTION_DAYS}`,
    );

  const source = sources.deliverySources?.find(
    ({ name }) => name === WEB_ACCESS_DELIVERY_NAME,
  );
  if (source?.service !== "cloudfront" || source?.logType !== "ACCESS_LOGS")
    throw new Error("CloudFront web access delivery source is missing");

  const destination = destinations.deliveryDestinations?.find(
    ({ name }) => name === WEB_ACCESS_DELIVERY_NAME,
  );
  if (
    destination?.deliveryDestinationType !== "CWL" ||
    destination?.outputFormat !== "json"
  )
    throw new Error("CloudWatch JSON web access destination is missing");

  const delivery = deliveries.deliveries?.find(
    ({ deliverySourceName }) => deliverySourceName === WEB_ACCESS_DELIVERY_NAME,
  );
  if (delivery?.deliveryDestinationType !== "CWL")
    throw new Error("CloudFront web access delivery is missing");

  return {
    callerArn: identity.Arn,
    logGroup: WEB_ACCESS_LOG_GROUP,
    retentionDays: group.retentionInDays,
    deliverySource: source.name,
    deliveryDestination: destination.name,
  };
}

async function runQuery({ endTime, queryString, startTime }) {
  const started = await awsJson([
    "logs",
    "start-query",
    "--log-group-name",
    WEB_ACCESS_LOG_GROUP,
    "--start-time",
    String(startTime),
    "--end-time",
    String(endTime),
    "--query-string",
    queryString,
  ]);

  for (let attempt = 0; attempt < QUERY_TIMEOUT_ATTEMPTS; attempt += 1) {
    const result = await awsJson([
      "logs",
      "get-query-results",
      "--query-id",
      started.queryId,
    ]);
    if (result.status === "Complete") return result;
    if (["Cancelled", "Failed", "Timeout", "Unknown"].includes(result.status))
      throw new Error(`CloudWatch Logs Insights query ${result.status}`);
    await delay(500);
  }
  throw new Error("CloudWatch Logs Insights query exceeded 30 seconds");
}

export async function collectWebActivity({
  hours = 24,
  now = new Date(),
} = {}) {
  if (process.env.AWS_REGION !== "us-east-1")
    throw new Error("Set AWS_REGION=us-east-1 for Run Drop");
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS)
    throw new Error(`hours must be an integer from 1 to ${MAX_HOURS}`);

  const access = await verifyAccessPath();
  const endTime = Math.floor(now.getTime() / 1000);
  const startTime = endTime - hours * 60 * 60;
  const names = Object.keys(WEB_ACTIVITY_QUERIES);
  const results = await Promise.all(
    names.map((name) =>
      runQuery({
        endTime,
        queryString: WEB_ACTIVITY_QUERIES[name],
        startTime,
      }),
    ),
  );
  const window = {
    hours,
    start: new Date(startTime * 1000).toISOString(),
    end: new Date(endTime * 1000).toISOString(),
  };
  return {
    ...summarizeWebActivity(
      Object.fromEntries(names.map((name, i) => [name, results[i]])),
      window,
    ),
    access,
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv) {
  try {
    print(await collectWebActivity({ hours: parseHours(argv) }));
  } catch (error) {
    print({
      status: "insufficient_evidence",
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
