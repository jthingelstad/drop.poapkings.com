# Fair Play evidence and decision policy

This is the durable adjudication rubric for Protect Fair Play. Apply it to the exact
run that earned a leaderboard position, with enough bounded player history to
interpret that run. Do not repeatedly evaluate unchanged evidence: use the stable
evidence digest and durable watermark. If the required cohort is incomplete, report
the exact backlog and do not call the review complete.

Practice and guest play can provide benign context but can never be ranked violations.
Top players are expected to look exceptional. Exceptional is not the same as automated.

## Required evidence

A responsible decision requires exact server-side evidence, never a reconstructed
summary or client claim:

- stable run ID and pseudonymous Drop player ID;
- mode, season, leaderboard scope, rank, score, and ordered tiebreaks;
- server-issued signed challenge and complete transcript with per-event timing;
- server start/completion times, wall-clock duration, recomputed score, and the
  scorer/integrity outcome;
- build, board epoch, and scoring/rules version needed to interpret the run;
- a direct link from the leaderboard entry to its earning run;
- bounded profile age, activity, ranked history, cross-mode history, and progression;
- a normalized Clash Royale player tag, when present, labeled unverified; and
- only privacy-minimized correlation signals Jamie has explicitly approved.

If required evidence is missing, incomplete, expired, or contradictory, use
`insufficient_evidence`. Absence of telemetry proves neither innocence nor abuse.

## Signals and counter-evidence

Judge patterns in context. No single soft signal supports an adverse action.

Run-level signals include sustained implausible response times across different
prompts; mechanical or repeated exact-millisecond cadence; extreme accuracy and speed
without human-like variation across multiple runs; duplicated answer, correction, or
timing sequences; transcript times clustering at client/server boundaries; conflict
with the signed challenge, UI mechanics, rules version, or wall time; and impossible
concurrent play by a strongly linked account cluster.

Player-level signals include elite results without a progression trail; abrupt changes
in speed, accuracy, volume, or mode behavior; coordinated bursts or highly regular
schedules; many accounts sharing behavioral signatures; many Drop accounts attached
to one unverified player tag; one account cycling rapidly through tags; and material
cross-mode inconsistencies. Specialization alone is benign.

Always weigh counter-evidence: gradual improvement; plausible timing, error,
correction, session, and fatigue variation; similar practice and ranked behavior;
stable mode strengths and weaknesses; lucky taps or learned sequences; accessibility
tools; and shared households, schools, workplaces, VPNs, carrier NAT, or devices.
Correlation is context, never identity proof.

## Dispositions

- `clear`: no material integrity concern in the available evidence. This does not
  certify that the player is human.
- `watch`: one or more soft anomalies merit comparison with future evidence, but the
  current record does not justify intervention.
- `review`: multiple independent signals, or one strong technically specific signal,
  create a material concern after benign explanations are considered.
- `insufficient_evidence`: required evidence is missing, incomplete, expired, or
  internally inconsistent.

For `watch` or `review`, record the exact evidence, benign explanations considered,
why the remaining concern crosses the selected threshold, what evidence could confirm
or reduce it, and whether the weakness is player-specific or systemic.

## Visibility

- `visible`: the scored run remains eligible for public boards. This includes normal
  `clear`/`watch` decisions and an approval restoring an earlier hide. A `review` may
  remain visible while evidence is gathered when the hidden threshold is not met.
- `hidden`: allowed only with `review`, and only when strong evidence supports that
  the exact performance was likely fabricated or gamed the rules. Exceptional speed,
  an automatic flag, a shared tag, or a soft anomaly is never sufficient alone.
- `not_ranked`: no reproducible candidate score exists, so leaderboard visibility does
  not apply. Any disposition may accompany it. A `clear`/`not_ranked` decision means
  the play appears genuine but scoreability needs product reconciliation.

Hiding is immediate but reversible. It never deletes or changes a run, score,
transcript, evidence, unrelated result, or account. A later audited `visible` decision
restores the exact run at its correct rank.

Automatic scorer or integrity output is triage, not authority. A flagged run with a
deterministic score can be retained under hidden review and then confirmed or restored
from exact evidence. An unscoreable attempt can be judged without inventing a rank.
Never treat words such as “invalid,” “impossible,” or “implausible” as a verdict.

When a case exposes a systemic defect, persist its evidence-grounded decision first.
Any later source repair must use sanitized synthetic fixtures and may not change the
stored case, canonical evidence, or a threshold to obtain a preferred result.

Use probabilistic, technical language in private rationale: “behavior consistent with
automation,” not “bot”; “linked-account pattern,” not “fake players.” Never turn an
inference into a public accusation.
