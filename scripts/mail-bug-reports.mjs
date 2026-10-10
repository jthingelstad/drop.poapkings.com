#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const CONTACT_ADDRESS = "drop@poapkings.com";
const CANARY_SENDER = "elixir@poapkings.com";
const DEFAULT_DAYS = 30;
const MAX_MESSAGES = 100;
const MAX_BODY_LENGTH = 4_000;

function addressValues(addresses) {
  return (addresses ?? [])
    .map((entry) =>
      String(entry.email ?? "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

export function isDeliveryCanary(email) {
  return (
    String(email.subject ?? "").startsWith("Elixir Drop mail canary") &&
    addressValues(email.from).includes(CANARY_SENDER)
  );
}

function redactEmailAddresses(value) {
  return value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[email redacted]",
  );
}

function boundedText(value, limit) {
  return redactEmailAddresses(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function textBody(email) {
  for (const part of email.textBody ?? []) {
    const value = email.bodyValues?.[part.partId]?.value;
    if (typeof value === "string" && value.trim()) return value;
  }
  return email.preview ?? "";
}

export function sanitizeBugReportEmail(email) {
  const sender = addressValues(email.from)[0] ?? "";
  const senderDomain = sender.includes("@")
    ? sender.split("@").at(-1)
    : undefined;
  return {
    messageId: email.id,
    receivedAt: email.receivedAt,
    subject: boundedText(email.subject, 200) || "(no subject)",
    ...(senderDomain ? { senderDomain } : {}),
    untrustedReportText: boundedText(textBody(email), MAX_BODY_LENGTH),
  };
}

function methodResponse(responses, callId) {
  const response = responses.find((entry) => entry[2] === callId);
  if (!response || response[0] === "error")
    throw new Error(`Fastmail JMAP call ${callId} failed`);
  return response[1];
}

export async function fetchBugReports({ token, since, fetchImpl = fetch }) {
  const sessionResponse = await fetchImpl(
    "https://api.fastmail.com/jmap/session",
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!sessionResponse.ok)
    throw new Error(`Fastmail session failed with ${sessionResponse.status}`);
  const session = await sessionResponse.json();
  const accountId = session.primaryAccounts?.["urn:ietf:params:jmap:mail"];
  if (!accountId || !session.apiUrl)
    throw new Error("Fastmail session has no primary mail account");

  const response = await fetchImpl(session.apiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        [
          "Email/query",
          {
            accountId,
            filter: {
              operator: "AND",
              conditions: [
                { to: CONTACT_ADDRESS },
                { after: new Date(since).toISOString() },
              ],
            },
            sort: [{ property: "receivedAt", isAscending: false }],
            limit: MAX_MESSAGES,
          },
          "query",
        ],
        [
          "Email/get",
          {
            accountId,
            "#ids": {
              resultOf: "query",
              name: "Email/query",
              path: "/ids",
            },
            properties: [
              "id",
              "receivedAt",
              "from",
              "to",
              "subject",
              "preview",
              "textBody",
              "bodyValues",
            ],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: false,
            maxBodyValueBytes: MAX_BODY_LENGTH,
          },
          "get",
        ],
      ],
    }),
  });
  if (!response.ok)
    throw new Error(`Fastmail JMAP failed with ${response.status}`);
  const payload = await response.json();
  methodResponse(payload.methodResponses ?? [], "query");
  const messages =
    methodResponse(payload.methodResponses ?? [], "get").list ?? [];
  return messages
    .filter(
      (email) =>
        addressValues(email.to).includes(CONTACT_ADDRESS) &&
        !isDeliveryCanary(email),
    )
    .map(sanitizeBugReportEmail);
}

function parseSince(argv) {
  const index = argv.indexOf("--since");
  if (index < 0) return Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1_000;
  const value = Date.parse(argv[index + 1] ?? "");
  if (!Number.isFinite(value))
    throw new Error("--since must be an ISO timestamp");
  return value;
}

async function main(argv) {
  const token = process.env.FASTMAIL_JMAP_TOKEN;
  if (!token) throw new Error("FASTMAIL_JMAP_TOKEN is required");
  const since = parseSince(argv);
  const reports = await fetchBugReports({ token, since });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        mailbox: CONTACT_ADDRESS,
        since: new Date(since).toISOString(),
        count: reports.length,
        reports,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        status: "insufficient_evidence",
        reason: "mail_review_failed",
        detail: error instanceof Error ? error.message : "unknown",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
