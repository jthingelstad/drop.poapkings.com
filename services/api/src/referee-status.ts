import type { RefereeDecision, RunReviewStatus } from "./types.js";

// One classifier for "did a hand investigation remove this run", shared by the
// owner's history, the public boards, badges, shares, and season awards, so no
// two surfaces can disagree about the same run.
//
// Since 2026-11-02 every run ranks when it finishes and carries no seal (Jamie:
// "Drop retires the Awaiting hold and the Cleared seal; every run ranks on
// finishing with no seal, and only a hand investigation can remove a run from
// the boards"). A person removes a run with `scripts/referee-decide.mjs`
// `--visibility hidden`, and a later `visible` decision restores it.
//
// Stored data is not rewritten. Two kinds of older record stay in the table
// and are ignored here, because neither was a person's final call:
//   - an automatic integrity-gate hold (`decidedBy: "integrity-gate"`), and
//   - a referee judgment reopened as a queue hold (`queueState: "pending"`).
// A `visible` referee decision (a "clear") changes nothing a player sees.
//
// The hidden branch fails closed on purpose. `decidedBy` is required on a
// stored decision, but if one ever arrives without a recognized value, a run a
// person marked hidden must stay off the board rather than rank because its
// record was malformed.
export function isExcludedFromBoards(
  decision: RefereeDecision | undefined,
): boolean {
  if (decision?.visibility !== "hidden") return false;
  return (
    decision.queueState !== "pending" && decision.decidedBy !== "integrity-gate"
  );
}

// The only status a run carries anywhere: `excluded`, owner-only. Undefined for
// every other run, which is almost every run.
export function runReviewStatus(
  decision: RefereeDecision | undefined,
): RunReviewStatus | undefined {
  return isExcludedFromBoards(decision) ? "excluded" : undefined;
}
