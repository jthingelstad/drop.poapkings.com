import type { RefereeDecision, RunReviewStatus } from "./types.js";

// One classifier for "what did the referee do to this run", shared by the
// owner's history and the public boards so the two surfaces can never drift
// into disagreeing about the same run.
//
// Both a neutral queue hold and a final exclusion are stored as
// `visibility: "hidden"`. What separates them is who decided and whether the
// decision is still open:
//   - an automatic integrity signal, or a referee judgment reopened as a queue
//     hold, is `pending` — awaiting a person, never a verdict
//   - any other hidden decision is `excluded`
//   - a fair-play-referee clear is `reviewed`
//
// The hidden branch fails closed on purpose. `decidedBy` is required on a
// stored decision, but if one ever arrives without a recognized value, a run a
// referee marked hidden must stay off the board rather than rank because its
// record was malformed.
//
// Returns undefined only when no referee has touched the run at all; each
// caller decides what an untouched run means on its own surface.
export function refereeReviewStatus(
  decision: RefereeDecision | undefined,
): RunReviewStatus | undefined {
  if (!decision) return undefined;
  if (decision.visibility === "hidden")
    return decision.queueState === "pending" ||
      decision.decidedBy === "integrity-gate"
      ? "pending"
      : "excluded";
  if (decision.decidedBy === "fair-play-referee") return "reviewed";
  return undefined;
}

// Board-side reading of the same decision. A pending run now ranks
// provisionally, so the only status that removes a run from a public board is
// `excluded`.
export type BoardReviewStatus = Exclude<RunReviewStatus, "excluded">;

export function isExcludedFromBoards(
  decision: RefereeDecision | undefined,
): boolean {
  return refereeReviewStatus(decision) === "excluded";
}

// Undefined when no referee has touched the run — which is almost every run.
// Those rows carry no status and no mark: "cleared" means a referee actually
// looked, and a board that stamps every ordinary run with it is claiming a
// review that never happened.
export function boardReviewStatus(
  decision: RefereeDecision | undefined,
): BoardReviewStatus | undefined {
  const status = refereeReviewStatus(decision);
  return status === "pending" || status === "reviewed" ? status : undefined;
}
