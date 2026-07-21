#!/usr/bin/env node
// referee-run.mjs <runId>
//
// Full annotated, sanitized evidence for one run: challenge, transcript, timing,
// recomputed score, scoring version, integrity outcome, and the opaque
// correlation hashes. Prints the pseudonymous playerId only.
//
// Resolution: evidence is keyed PLAYER#{sub}/EVIDENCE#{completedAt}#{runId}, so
// there is no direct GetItem by runId alone. We scan for the EVIDENCE# item whose
// `runId` attribute matches (bounded at beta scale; the read role has Scan), then
// map its owning sub -> playerId and strip every internal identifier.

import {
  client,
  currentDecision,
  failClosed,
  findEvidenceByRunId,
  parseFlags,
  playerIdForSub,
  print,
  sanitize,
  sanitizeRecord,
} from "./_referee-lib.mjs";

const { positional } = parseFlags(process.argv.slice(2));
const runId = positional[0];
if (!runId) failClosed("missing_run_id", "usage: referee-run.mjs <runId>");

const doc = client();

let evidence;
try {
  evidence = await findEvidenceByRunId(doc, runId);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}

if (!evidence)
  failClosed("evidence_not_found", `No retained evidence for run ${runId}`);

let playerId;
let decision;
try {
  [playerId, decision] = await Promise.all([
    playerIdForSub(doc, evidence.playerSub),
    currentDecision(doc, runId),
  ]);
} catch (error) {
  failClosed("read_failed", error instanceof Error ? error.message : "unknown");
}
if (!playerId) {
  // The owning profile is gone (account deleted): the evidence was swept too, or
  // is mid-deletion. Nothing reviewable.
  failClosed("player_not_found", "Owning profile is absent (deleted account)");
}

print({
  status: "ok",
  run: sanitize(evidence, playerId),
  ...(decision ? { decision: sanitizeRecord(decision) } : {}),
});
