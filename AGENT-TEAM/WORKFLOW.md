# AGENT-TEAM operating model

Drop is maintained by five objective owners. An owner is accountable for an outcome,
not a job type or directory. It follows evidence through diagnosis, code, tests,
deployment, and natural acceptance instead of handing each step to another role.

Read the concise Codex `AGENTS.override.md` (or `AGENTS.md` for other agents),
this file, `AGENT-TEAM/README.md` and the selected objective before acting.
Read the relevant `AGENTS.md` architecture/product sections and canonical
reference documents for the affected surface; the entry point does not replace them.

## One worktree per run

Scheduled runs used to share this checkout and collided with each other and with
Jamie's sessions. Since 2026-09-29 each run works in its own git worktree:

- Codex creates it (`execution_environment = "worktree"` in `automations.toml`)
  and runs `.codex/environments/environment.toml`, whose
  `AGENT-TEAM/scripts/worktree-setup.sh` moves it to a freshly fetched
  `origin/main`, links the gitignored `.env`, `AGENT-TEAM/notes` and
  `design-ref` from the main checkout (links, never copies: a copy of a secrets
  file is a secret), links the sibling repositories beside it, and runs
  `npm ci`. It is discarded when the run ends.
- The main checkout (`~/Projects/clash-royale/drop.poapkings.com`) belongs to
  Jamie and interactive sessions. A scheduled run never edits, switches or
  pulls it.
- Nothing a run does in its worktree needs a lease: edits, commits, pushes and
  pull requests are private until they merge, and `main` takes only pull
  requests. The merge deploys, and `Build and Deploy` serializes itself.
- The **production-write lease** (`objective-lease.mjs`, kept in the git
  common directory so every worktree sees it) serializes only the writes a run
  makes to production outside that pipeline: an out-of-band
  `npm run deploy:api`, a referee decision, a run-report triage, or an Updates
  publication. Keys: `run`, `grow`, `improve`, `season`, `fair-play`, and the
  domain team's `clock` and `game`.

## Operating loop

1. Run `AGENT-TEAM/scripts/preflight.sh` in the run's worktree. A dirty, behind,
   diverged, or unexpectedly ahead worktree makes the run read-only. Never publish
   a pre-existing commit. Preflight reports a held production-write lease; it does
   not stop the run.
2. Measure current state from the public site/API, exact AWS/CI evidence, retained
   product data, sanctioned referee tools, or the active issue as appropriate.
3. Decide whether a real objective gap exists. Healthy is a complete result.
4. When a safe authorized gap requires a change, `git switch -c <objective>/<slug>`
   in the worktree before the first edit.
5. Fix the gap at the source in the same run. Add the business-rule regression; do
   not substitute a warning, guard, or ticket chain. Player-visible is not sufficient
   for an Update. Only when the outcome passes the canonical notification bar in
   `AGENTS.md`, publish one impact category, one subject, and one Markdown paragraph
   through `AGENT-TEAM/scripts/player-updates.mjs` after the player outcome is live.
   This API write is separate from the code deployment. Related work earns one card,
   and silence is the default. Follow the exact list/publish commands, Markdown
   limits, success response, and post-publish check in `AGENT-TEAM/README.md`;
   publishing never requires an AWS profile or login.
6. Only immediately before a production write outside the merge pipeline (step 5's
   Update, a referee decision, a run-report triage, an out-of-band deploy), claim
   the lease with
   `node AGENT-TEAM/scripts/objective-lease.mjs claim <run|grow|improve|season|fair-play>`
   and retain the returned `leaseId`. A held lease defers that write, not the run's
   other work: finish the pull request and report the write as waiting. Never clear
   a lease merely because it looks old: automatic clearing also requires the same
   host, a dead recorded process, an unchanged starting commit, and a clean holder
   worktree; otherwise inspect it and use the exact holder identity for a confirmed
   manual clear.
7. Run focused checks while iterating and the change-specific final gate from
   `CONTRIBUTING.md` before commit. Commit only current-run work, push the branch,
   `gh pr create --fill`, `gh pr merge --auto --rebase --delete-branch`, and
   `gh pr checks --watch --fail-fast` (`AGENTS.md` → "Landing changes").
   Unfinished work stays an open PR; the worktree is discarded at the end of the
   run, so nothing worth keeping may live only in it.
8. Once merged, `git fetch origin && git checkout --detach origin/main` in the
   worktree (never `git switch main`: main is the main checkout's branch). Verify
   `Validate Main`, the triggered `Build and Deploy` workflow for the merge SHA, and
   each live surface the classifier ships. Use `npm run deploy:api` only for the
   documented out-of-band exception, from that detached `origin/main` and under the
   lease.
9. Verify semantic success from natural product evidence. Do not create guest runs,
   player accounts, leaderboard entries, email, or referee cases merely for acceptance.
10. Release only this run's token with
    `node AGENT-TEAM/scripts/objective-lease.mjs release <objective> <leaseId>` once
    the write is verified and the worktree is clean. If safe cleanup is impossible,
    leave the lease and report it.

## Ownership and acceptance

- The originating objective verifies the normal `Build and Deploy` run and live
  surface for its own commit; it does not wait for a separate Drop Operator confirmation.
- The Drop Operator owns failed-pipeline recovery and continuing system-health acceptance.
  A failure that spans runs becomes an `objective:run` issue; normal deployment is
  not a handoff.
- The originating objective owns semantic acceptance. The Drop Growth Manager proves an acquisition
  or retention outcome moved; the Drop Game Designer proves the changed player journey works;
  the Drop Season Commentator proves its commentary is factual and live; the Drop Fair Play Referee proves
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
other significant product direction. Routine source-backed season commentary published
through the Updates API is pre-authorized: current public leaders,
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

Report the measured outcome and remaining risk, not workflow ceremony. A monthly Drop Growth Manager pass may recommend one specific contract correction when evidence shows duplicated
work, collisions, manufactured findings, or stalled acceptance; there is no separate
Team Manager.

## Calendar and due work

`automations.toml` owns the calendar; `SCHEDULE.md` is its generated view.
Keep the installed prompt's interval guards and anchors. For weekly, monthly
or quarterly subtasks, retain last successful evidence and the next due date
in compact current state. A retry checks that receipt before repeating work;
a blocked due subtask remains due at the next eligible invocation. Required
every-run baselines still run. Explicit incident/deploy starts do not invent
automatic triggers or authorize early member activity.
