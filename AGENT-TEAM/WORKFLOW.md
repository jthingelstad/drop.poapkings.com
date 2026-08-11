# AGENT-TEAM operating model

Drop is maintained by three objective owners. An owner is accountable for an outcome,
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
4. If the gap is safe and authorized, fix it at the source in the same run. Add the
   business-rule regression; do not substitute a warning, guard, or ticket chain.
5. Recheck branch, upstream, worktree, and other active work immediately before the
   first edit and before push. Stop if the state changed.
6. Run focused checks while iterating and `npm run verify` before commit. Commit and
   push only current-run work directly to `main`.
7. Verify the `Build and Deploy` workflow and live API/site when the change ships.
   Use `npm run deploy:api` only for the documented out-of-band exception.
8. Verify semantic success from natural product evidence. Do not create guest runs,
   player accounts, leaderboard entries, email, or referee cases merely for acceptance.

## Ownership and acceptance

- Run Drop owns deployment and technical-health acceptance for every shipped change.
- The originating objective owns semantic acceptance. Grow Drop proves a product
  outcome moved; Protect Fair Play proves coverage or adjudication behavior is sound.
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
winner/prize action, public enforcement, broad member communication, irreversible
state changes, and other significant product direction. Ask one concrete yes/no
question with evidence and the smallest useful version.

Ordinary bug, reliability, observability, documentation, referee-tooling, and narrow
quality fixes are autonomous when they preserve that boundary.

## Automation memory

Automation memory contains only `Current state`, `Active watches`, and one
replace-in-place `Latest run`. Remove resolved watches. Git, issues, CI, AWS audit
records, and product/referee ledgers hold history.

## Reporting

End as `Healthy`, `Changed`, or `Needs decision`. Report the measured outcome and
remaining risk, not workflow ceremony. A monthly Grow Drop pass may recommend one
specific contract correction when evidence shows duplicated work, collisions,
manufactured findings, or stalled acceptance; there is no separate Team Manager.
