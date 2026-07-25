# AGENT-TEAM/ — Elixir Drop product team

Role-prompts for Codex/Claude agents that keep Elixir Drop healthy, fair, and growing. These
roles are scheduled and burn down a queue. Each file is a self-contained job description: a
lane, an explicit boundary, an "Every run" runbook, and a success definition.

Cutting a named release is **not** one of these roles. It is a user-invoked skill in the build
process — `.claude/skills/cut-release/` — because it runs only when Jamie explicitly asks,
holds no lane, and burns down no queue. See "Releases" below.

**The workflow these roles share** — the GitHub-Issues spine, the approval gate, the label
taxonomy, `wip` claiming, commit lanes, the `notes/` convention, and the operating rules — is
defined once in **[`WORKFLOW.md`](WORKFLOW.md)** and is identical across all of Jamie's
projects. This README covers only what's specific to _this_ project. Every role reads
`AGENTS.md` → `WORKFLOW.md` → this file → its role file, then acts.

```
AGENT-TEAM/
  WORKFLOW.md          # the shared contract (identical across projects)
  README.md            # this file — Elixir Drop specifics
  <role>.md            # the roster below
  scripts/             # setup-labels.sh · preflight.sh · queue-audit.sh · new-note.sh
                       #   (+ the referee's own referee-*.mjs, its sanctioned data path)
  notes/               # gitignored per-run scratch
  summaries/           # committed weekly Manager digests
```

## North star + the hard boundary

**Elixir Drop's team RUNS Drop — it does not rebuild it.** The default verb is _operate,
detect, and fix_: keep the game up, correct, and fair; make it easy for more people to play;
ship what's shipped as a named release. The team is empowered to **detect → fix → test →
commit → deploy** for bugs, regressions, ops incidents, card-catalog drift, and small quality
fixes.

The line the team does **not** cross without Jamie: a **new game / new mode**, a material
change to **scoring or season rules**, or any large / irreversible / significant user-facing
change. Those are `proposal` issues the **Manager's approval gate** holds until Jamie approves.
Defects don't need approval; new product direction does.

## The team

| Role                    | File                    | Lane                                                                      | Commits?                            |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Fair-Play Referee       | `fair-play-referee.md`  | Competitive integrity — independent run review + visibility decisions     | Referee decision partitions only    |
| Operations Manager      | `operations-manager.md` | Production health: Lambda/DynamoDB/Pages/JMAP, deploys, incidents, cost   | Yes — ops fixes + `deploy:api`      |
| Build Manager           | `build-manager.md`      | Detect + fix bugs & regressions, maintenance, keep `cards.json` current   | **Yes — owns fix/maintenance code** |
| Growth & Season Analyst | `growth-analyst.md`     | Get more people playing + season/leaderboard liveliness + the funnel data | No — issue-only                     |
| Manager                 | `manager.md`            | Weekly meta-review of the team + the approval gate                        | Own `summaries/` only               |

The **Fair-Play Referee** and **Growth & Season Analyst** are Drop's **domain roles**;
Operations Manager, Build Manager, and Manager are the standard core (shared across projects).
The Referee is deliberately independent — the role judging leaderboard fairness is never the
role that builds or ships. Commit lanes and the approval gate are defined in `WORKFLOW.md`.

Two standard core roles are intentionally **folded, not dropped** (this is a lean run-it team,
not a feature factory): the **Evaluator's** test/regression discipline lives inside the Build
Manager (fixes ship with tests), and the **Product Manager's** only load-bearing function — the
approval gate — lives inside the Manager. If either ever needs an independent voice, split the
**Evaluator** back out first (it files `eval` issues and owns the test harnesses).

## Runtime map

Roles should name the layer + file that supplied every finding.

- **Frontend:** `apps/web` — Preact + @preact/signals + Vite SPA on GitHub Pages, hash
  routing. Two shells (`lib/use-layout` @1024): a fixed **1280-wide** desktop, a mobile
  single-column shell.
- **Backend:** `services/api` — one TypeScript **Lambda** + one **DynamoDB** table (pk/sk +
  GSI1/GSI2). Owns scoring/selection via signed challenges, magic-link auth, leaderboards, and
  the recent-activity feed.
- **Deploys:** one pipeline off a push to `main` ships **both** surfaces — the API stack first,
  then Pages rebuilt against it. `npm run deploy:api` stays the Operations Manager's tool for
  stack creation, secret rotation, and recovering a pipeline run that did not finish. The full
  statement lives in `AGENTS.md` → "Deploy model".
- **CR bridge:** `services/cr-api-bridge` — the only runtime Clash Royale API ingress
  (fixed-IP, allowlisted host). The browser and Lambda never call CR directly; the committed
  `packages/game-data/cards.json` snapshot is authoritative for the running app.
- **Email:** transactional messages use **Fastmail JMAP** (`services/api/src/jmap.ts`,
  `FASTMAIL_JMAP_TOKEN`); bulk release notes use the dedicated **Buttondown**
  newsletter. No SES, no BCC batching.
- **Integrity:** the Referee's sanctioned data + decision path is `AGENT-TEAM/scripts/referee-*.mjs`;
  it emits pseudonymous `playerId`, never `sub`/email, and writes only `REFEREE#` partitions.

## Releases

Drop ships as **named releases** (no SemVer — a coined name + date + build hash), modeled on
Elixir's ceremony. This is a **skill, not a role**: `.claude/skills/cut-release/` →
`scripts/cut-release.mjs`. After Jamie explicitly says it is release time, coin an alliterative
**Clash Royale card** name, tag the already-live `origin/main` commit, publish a **GitHub
release**, and create a **Buttondown draft** for Jamie to review and send. GitHub Releases are
the release history. The ceremony never decides timing, opens a tracking issue, commits product
metadata, deploys, or sends the email.

It is a skill rather than a team role because it has no lane and no queue: it fires only on
Jamie's explicit ask, and everything it does is one bounded, idempotent ceremony. That also
puts it outside the shared issue/`wip` and local-worktree preflight, which only ever made sense
for queue work. The tool fetches and validates `origin/main`, then confirms the caller's
worktree is unchanged; unrelated local commits or edits are never tagged or pushed.

## Suggested cadence

Recommended defaults — actual scheduling lives in Codex/Claude routines. All times America/Chicago.

| Role                    | Cadence                                     | Why                                                       |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Operations Manager      | Hourly (or every few hours)                 | Public prod needs a tight loop                            |
| Fair-Play Referee       | Daily                                       | Keep the ranked boards real                               |
| Build Manager           | Daily                                       | Steady defect + maintenance burn-down                     |
| Growth & Season Analyst | Weekly + at season boundaries               | Engagement reads over a wider window                      |
| Manager                 | Weekly                                      | Team-health review + the notes digest + the approval gate |

The `cut-release` skill has no cadence by design — it runs when Jamie asks, and never otherwise.

## Label ownership notes (Drop domain labels)

Beyond the shared taxonomy in `WORKFLOW.md`, Drop adds `integrity` and `growth`
(see `scripts/setup-labels.sh` → PROJECT EXTENSIONS):

- `integrity` — competitive-fairness findings from the Fair-Play Referee. A defect the Referee
  spots in the game (not a visibility decision) is handed to the Build Manager as a `bug`.
- `growth` — a triage signal from the Growth & Season Analyst about playerbase or season
  liveliness. It is **not** a build-ready work order: the Manager weighs it and, if there's a
  clear next action, it becomes a `proposal` (new direction, needs Jamie) or a `bug`/`enhancement`.
  Build Manager skips bare `growth` issues.
