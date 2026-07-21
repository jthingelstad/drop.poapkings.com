#!/usr/bin/env node
// referee-decide.mjs <runId> --disposition clear|watch|review|insufficient_evidence
//   --visibility visible|hidden|not_ranked --reason <private concise rationale>
//
// The only sanctioned referee write path. It never edits a score, transcript,
// player, or leaderboard row. It writes an independent current decision and an
// immutable audit event under REFEREE#{runId}; public leaderboard reads apply
// the current visibility as an overlay.

import { createHash } from "node:crypto";
import {
  client,
  currentDecision,
  failClosed,
  findEvidenceByRunId,
  parseFlags,
  print,
  sanitizeRecord,
  TABLE_NAME,
  TransactWriteCommand,
} from "./_referee-lib.mjs";

const DISPOSITIONS = new Set([
  "clear",
  "watch",
  "review",
  "insufficient_evidence",
]);
const VISIBILITIES = new Set(["visible", "hidden", "not_ranked"]);

const { flags, positional } = parseFlags(process.argv.slice(2));
const runId = positional[0];
const disposition = flags.disposition;
const visibility = flags.visibility;
const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";

if (!runId)
  failClosed(
    "missing_run_id",
    "usage: referee-decide.mjs <runId> --disposition <value> --visibility <value> --reason <text>",
  );
if (!DISPOSITIONS.has(disposition))
  failClosed(
    "invalid_disposition",
    "--disposition must be clear, watch, review, or insufficient_evidence",
  );
if (!VISIBILITIES.has(visibility))
  failClosed(
    "invalid_visibility",
    "--visibility must be visible, hidden, or not_ranked",
  );
if (visibility === "hidden" && disposition !== "review")
  failClosed(
    "invalid_hidden_disposition",
    "A hidden run must carry the review disposition",
  );
if (reason.length < 8 || reason.length > 1_000)
  failClosed("invalid_reason", "--reason must contain 8..1000 characters");

const doc = client();
let evidence;
let previous;
try {
  [evidence, previous] = await Promise.all([
    findEvidenceByRunId(doc, runId),
    currentDecision(doc, runId),
  ]);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (!evidence)
  failClosed("evidence_not_found", `No retained evidence for run ${runId}`);
const subjectType =
  evidence.runType === "ranked" && Number.isFinite(evidence.score)
    ? "ranked_run"
    : "unscored_attempt";
if (subjectType === "ranked_run" && visibility === "not_ranked")
  failClosed(
    "invalid_ranked_visibility",
    "A deterministically scored ranked run must be visible or hidden",
  );
if (subjectType === "unscored_attempt" && visibility !== "not_ranked")
  failClosed(
    "score_required_for_ranking",
    "An unscored attempt may be judged, but ranking requires a reproducible candidate score",
  );

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const decidedAt = new Date().toISOString();
const evidenceDigest = createHash("sha256")
  .update(canonicalJson(evidence))
  .digest("hex");
const fields = {
  runId,
  subjectType,
  disposition,
  visibility,
  reason,
  evidenceDigest,
  decidedAt,
  decidedBy: "fair-play-referee",
  schemaVersion: "1",
};
const current = { pk: `REFEREE#${runId}`, sk: "CURRENT", ...fields };
const history = {
  pk: `REFEREE#${runId}`,
  sk: `DECISION#${decidedAt}`,
  ...fields,
};

try {
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: history,
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        { Put: { TableName: TABLE_NAME, Item: current } },
      ],
    }),
  );
} catch (error) {
  failClosed(
    "write_failed",
    error instanceof Error ? error.message : "unknown",
  );
}

print({
  status: "ok",
  decision: sanitizeRecord(current),
  ...(previous ? { previous: sanitizeRecord(previous) } : {}),
});
