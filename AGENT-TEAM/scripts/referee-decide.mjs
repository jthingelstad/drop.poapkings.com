#!/usr/bin/env node
// referee-decide.mjs <runId-or-reference> --disposition clear|watch|review|insufficient_evidence
//   --visibility visible|hidden|not_ranked --reason <private concise rationale>
//   [--player-reason <safe categorical explanation>]
// referee-decide.mjs <runId-or-reference> --pending --reason <private concise rationale>
// referee-decide.mjs <runId-or-reference> --reopen --approved-by jamie
//   --reason <private concise rationale>
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
  playerIdForSub,
  print,
  runReference,
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
const PLAYER_EXPLANATION_CODES = new Set([
  "automated_input",
  "response_timing",
  "altered_play_record",
  "ranked_rules",
  "combined_evidence",
]);

const { flags, positional } = parseFlags(process.argv.slice(2));
const runIdentifier = positional[0];
const automaticPending = flags.pending === true;
const reopening = flags.reopen === true;
const pending = automaticPending || reopening;
const disposition = pending ? "review" : flags.disposition;
const visibility = pending ? "hidden" : flags.visibility;
const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";
const playerExplanationCode =
  typeof flags["player-reason"] === "string"
    ? flags["player-reason"].trim()
    : "";

if (!runIdentifier)
  failClosed(
    "missing_run_id",
    "usage: referee-decide.mjs <runId-or-reference> (--pending | --reopen --approved-by jamie | --disposition <value> --visibility <value>) --reason <text> [--player-reason <code>]",
  );
if (automaticPending && reopening)
  failClosed(
    "conflicting_pending_flags",
    "--pending and --reopen are mutually exclusive",
  );
if (pending && (flags.disposition || flags.visibility))
  failClosed(
    "invalid_pending_flags",
    "--pending/--reopen cannot be combined with --disposition or --visibility",
  );
if (reopening && flags["approved-by"] !== "jamie")
  failClosed(
    "approval_required",
    "--reopen requires --approved-by jamie from the current task",
  );
if (!reopening && flags["approved-by"])
  failClosed(
    "unexpected_approval",
    "--approved-by is only valid with --reopen",
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
if (
  visibility === "hidden" &&
  !pending &&
  !PLAYER_EXPLANATION_CODES.has(playerExplanationCode)
)
  failClosed(
    "player_reason_required",
    "A referee-excluded run requires --player-reason automated_input, response_timing, altered_play_record, ranked_rules, or combined_evidence",
  );
if ((pending || visibility !== "hidden") && playerExplanationCode)
  failClosed(
    "unexpected_player_reason",
    "--player-reason is only valid for a referee-excluded hidden run",
  );

const doc = client();
let evidence;
let previous;
let playerId;
try {
  evidence = await findEvidenceByRunId(doc, runIdentifier);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (!evidence)
  failClosed(
    "evidence_not_found",
    `No retained evidence for run ${runIdentifier}`,
  );
const runId = String(evidence.runId);
try {
  previous = await currentDecision(doc, runId);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (automaticPending && previous?.decidedBy === "fair-play-referee")
  failClosed(
    "referee_decision_is_authoritative",
    "An automatic pending hold cannot replace an existing referee decision",
  );
if (
  reopening &&
  (previous?.decidedBy !== "fair-play-referee" ||
    previous.queueState === "pending")
)
  failClosed(
    "referee_decision_not_reopenable",
    "--reopen requires an existing completed referee judgment that is not already pending",
  );
const subjectType =
  evidence.runType === "ranked" && Number.isFinite(evidence.score)
    ? "ranked_run"
    : "unscored_attempt";
if (subjectType === "ranked_run") {
  const sub =
    typeof evidence.playerSub === "string"
      ? evidence.playerSub
      : typeof evidence.pk === "string" && evidence.pk.startsWith("PLAYER#")
        ? evidence.pk.slice("PLAYER#".length)
        : undefined;
  if (!sub)
    failClosed(
      "player_not_found",
      "The ranked run evidence has no owning player",
    );
  try {
    playerId = await playerIdForSub(doc, sub);
  } catch (error) {
    failClosed(
      "read_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  if (!playerId)
    failClosed(
      "player_not_found",
      "The ranked run no longer resolves to a player profile",
    );
}
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
  ...(playerExplanationCode ? { playerExplanationCode } : {}),
  ...(reopening ? { queueState: "pending" } : {}),
  evidenceDigest,
  decidedAt,
  decidedBy: automaticPending ? "integrity-gate" : "fair-play-referee",
  schemaVersion: "1",
};
const current = { pk: `REFEREE#${runId}`, sk: "CURRENT", ...fields };
const history = {
  pk: `REFEREE#${runId}`,
  sk: `DECISION#${decidedAt}`,
  ...fields,
};
const badgeMarker = playerId
  ? {
      pk: `REFEREE#PLAYER#${playerId}`,
      sk: `BADGE#DECISION#${decidedAt}#${runId}`,
      runId,
      decidedAt,
      visibility,
      ...(reopening ? { queueState: "pending" } : {}),
      decidedBy: fields.decidedBy,
      schemaVersion: "1",
    }
  : undefined;

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
        ...(badgeMarker
          ? [
              {
                Put: {
                  TableName: TABLE_NAME,
                  Item: badgeMarker,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Update: {
                  TableName: TABLE_NAME,
                  Key: {
                    pk: `REFEREE#PLAYER#${playerId}`,
                    sk: "BADGES",
                  },
                  UpdateExpression:
                    "SET updatedAt = :updatedAt ADD decisionRevision :one",
                  ExpressionAttributeValues: {
                    ":updatedAt": decidedAt,
                    ":one": 1,
                  },
                },
              },
            ]
          : []),
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
  runReference: runReference(runId),
  decision: sanitizeRecord(current),
  ...(previous ? { previous: sanitizeRecord(previous) } : {}),
});
