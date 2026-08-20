# AGENT-TEAM operating model

Drop is maintained by five objective owners. An owner is accountable for an outcome,
not a job type or directory. It follows evidence through diagnosis, code, tests,
deployment, and natural acceptance instead of handing each step to another role.

Read `AGENTS.md` → `CLAUDE.md` → this file → `AGENT-TEAM/README.md` → the selected
objective file before acting.

## Operating loop

1. Run `AGENT-TEAM/scripts/preflight.sh`. A dirty, behind, diverged, detached, or
   unexpectedly ahead checkout makes the run read-only. Never publish a pre-existing
   commit.
2. Measure current state from the public site/API, exact AWS/CI evidence, retained
   product data, sanctioned referee tools, or the active issue as appropriate.
3. Decide whether a real objective gap exists. Healthy is a complete result.
4. Only when a safe authorized gap requires mutation, claim the checkout with
   `node AGENT-TEAM/scripts/objective-lease.mjs claim <run|grow|improve|season|fair-play>`. Retain
   the returned `leaseId` for this run. A held lease leaves the run read-only. Never
   clear one merely because it looks old: automatic clearing also requires the same
   host, a dead recorded process, an unchanged starting commit, and a clean worktree;
   otherwise inspect it and use the exact holder identity for a confirmed manual clear.
5. Fix the gap at the source in the same run. Add the business-rule regression; do
   not substitute a warning, guard, or ticket chain. When the change gives players
   a durable new feature, visible behavior, or rule, add one subject and one Markdown
   paragraph to `apps/web/src/data/updates/features.json` in the same commit. Never
   add an update for maintenance, refactors, tests, dependencies, deployment,
   telemetry, or private tooling.
6. Recheck the lease with `objective-lease.mjs check <objective> <leaseId>`, then
   recheck the branch, upstream, and worktree immediately before the first edit and
   before push. Stop if the state changed.
7. Run focused checks while iterating and the change-specific final gate from
   `CONTRIBUTING.md` before commit. Commit and push only current-run work directly
   to `main`.
8. Verify `Validate Main`, the triggered `Build and Deploy` workflow, and each live
   surface the classifier ships. Use `npm run deploy:api` only for the documented
   out-of-band exception.
9. Verify semantic success from natural product evidence. Do not create guest runs,
   player accounts, leaderboard entries, email, or referee cases merely for acceptance.
10. Release only this run's token with
    `node AGENT-TEAM/scripts/objective-lease.mjs release <objective> <leaseId>` after
    the repository is clean. If safe cleanup is impossible, leave the lease and report it.

## Ownership and acceptance

- The originating objective verifies the normal `Build and Deploy` run and live
  surface for its own commit; it does not wait for a separate Run Drop confirmation.
- Run Drop owns failed-pipeline recovery and continuing system-health acceptance.
  A failure that spans runs becomes an `objective:run` issue; normal deployment is
  not a handoff.
- The originating objective owns semantic acceptance. Grow Drop proves an acquisition
  or retention outcome moved; Improve Drop proves the changed player journey works;
  Call the Season proves its commentary is factual and live; Protect Fair Play proves
  coverage or adjudication behavior is sound.
- A clean deploy never substitutes for the originating objective's natural evidence.

## Issues are the exception ledger

Do not open an issue to authorize, claim, route, deploy, evaluate, or close same-run
work. Retain one only when work spans runs, an external dependency blocks it, Jamie
must decide, or the arc needs a durable record. Give it exactly one objective label.

There are no dispatch labels, handoff labels, `wip` claims, or commit lanes. Descriptive
labels do not transfer ownership. An objective keeps the issue until its acceptance
condition is met.

## Human boundary

Jamie decides new modes, material scoring/season rules, privacy-affecting collection,
Free Pass winner selection and prize action, public enforcement, broad member
communication outside the standing Updates contract, irreversible state changes, and
other significant product direction. Routine source-backed season commentary in
`apps/web/src/data/updates/seasons.json` is pre-authorized: current public leaders,
scores, season timing, and the designated Free Pass race. A closed game's champion may
be stated only from a Cleared winning run; naming the Free Pass recipient still requires
Jamie's approval. Ask one concrete yes/no question with evidence and the smallest
useful version.

Ordinary bug, reliability, observability, documentation, referee-tooling, and narrow
quality fixes are autonomous when they preserve that boundary.

## Automation memory

Automation memory contains only `Current state`, `Active watches`, and one
replace-in-place `Latest run`. Remove resolved watches. Git, issues, CI, AWS audit
records, and product/referee ledgers hold history.

## Reporting

End as `HEALTHY`, `CHANGED`, `WATCHING`, `BLOCKED`, or `NEEDS JAMIE`:

```text
Outcome: HEALTHY | CHANGED | WATCHING | BLOCKED | NEEDS JAMIE
Objective: <objective name>
Evidence: <most decision-relevant facts>
Action: <what changed, or None>
Next check: <natural event/date, or None>
Jamie: <one yes/no question, or None>
```

Report the measured outcome and remaining risk, not workflow ceremony. A monthly Grow
Drop pass may recommend one specific contract correction when evidence shows duplicated
work, collisions, manufactured findings, or stalled acceptance; there is no separate
Team Manager.
