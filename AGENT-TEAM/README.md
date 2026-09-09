# AGENT-TEAM — objective owners for Elixir Drop

Five objective owners maintain Drop. Each owns a durable outcome through
measurement, implementation, verification, deployment acceptance, and natural
product acceptance. There is no Build Manager, Team Manager, or routing pipeline.

## The team

| Objective | File | Cadence | Primary question |
|---|---|---|---|
| **Run Drop** | `run-drop.md` | Daily and after incidents/deploys | Is the public game healthy, correct, current, observable, and inexpensive to run? |
| **Grow Drop** | `grow-drop.md` | Daily and at season boundaries | Are more people reaching a first recorded run and returning? |
| **Improve Drop** | `improve-drop.md` | Weekly and after meaningful player-facing changes | Is playing Drop becoming clearer, more satisfying, and more effective? |
| **Call the Season** | `call-the-season.md` | Daily check; opening, weekly, and closing publication | Do players know who leads every ranked game and how the rotating Free Pass race stands? |
| **Protect Fair Play** | `protect-fair-play.md` | Daily and before prize/result decisions | Are ranked results trustworthy and are uncertain cases handled privately, reversibly, and from exact evidence? |

Building and testing are capabilities of every objective owner. New modes, material
scoring or season changes, privacy-affecting signals, public accusations, prize
decisions, and other large member-visible direction still belong to Jamie.

The former five-role queue and weekly Manager are retired. Git history and
`summaries/` preserve that period. The Fair Play objective remains independently
bounded: it may repair established tooling or scoring defects from sanitized,
synthetic evidence, but it may never alter a live case, canonical run, or threshold
to obtain a preferred verdict.

## How Jamie engages the team

Jamie can start with the outcome instead of choosing a role or preparing a ticket:

- `Run <objective> now and own the highest-impact measured gap.`
- `Investigate <symptom>; choose the owner by the failed outcome, not the file.`
- `Show me team status only; make no changes.`
- `What across this team needs Jamie?`
- `Resume the active watch for <objective or issue>.`

Choose **Run Drop** for availability, execution, deploys, persistence, ordinary defects,
recovery, or cost; **Grow Drop** for acquisition, first-run conversion, and retention;
**Improve Drop** for a working experience that is confusing, flat, awkward, or weak at
teaching; **Call the Season** for factual standings and Free Pass commentary; and
**Protect Fair Play** for evidence integrity, referee coverage, and reversible visibility
decisions. Cross-cutting work keeps one originating owner.

## Project map

- `AGENTS.md` is the repository and architecture source of truth (`CLAUDE.md` is a
  symlink to it).
- `SPEC.md` owns the implemented product/data contract; `GAMES.md` owns mode and
  scoring decisions.
- `CONTRIBUTING.md` owns the change-specific local and CI source gates.
- `AGENT-TEAM/scripts/objective-lease.mjs` serializes mutating objective runs in the
  shared checkout.
- `AGENT-TEAM/scripts/season-brief.mjs` builds Call the Season's public, sanitized
  five-board snapshot without referee or AWS access.
- `python3 AGENT-TEAM/scripts/automation_audit.py` verifies the registry against installed
  Codex tasks; use `--registry-only` in source-only checks.
- `.github/workflows/validate-main.yml` gates `main`; `deploy.yml` serializes and
  ships only the validated production surfaces.
- `AGENT-TEAM/scripts/referee-*.mjs` are the sanctioned referee read/decision path.
- `AGENT-TEAM/fair-play-policy.md` is the durable evidence and decision rubric.
- `AGENT-TEAM/scripts/player-updates.mjs` lists and immediately publishes the
  API-backed player-message stream. The complete operator contract and commands
  are below.

## Player Updates CLI

Every objective automation reads this file. Run these commands from the repository
root; `--help` prints the same command summary.

Inspect the newest published cards before writing:

```sh
node AGENT-TEAM/scripts/player-updates.mjs --help
node AGENT-TEAM/scripts/player-updates.mjs list --limit 25
node AGENT-TEAM/scripts/player-updates.mjs list --limit 100 --json
```

Publish one card immediately:

```sh
node AGENT-TEAM/scripts/player-updates.mjs publish \
  --kind season \
  --title '<subject, at most 55 characters>' \
  --body '<one Markdown paragraph, at most 60 words>'
```

Use `feature`, `season`, or `message`. A `feature` also requires exactly one
`--impact`: `gameplay`, `learning`, `competition`, `progression`, `access`,
`sharing`, `identity`, or `account-privacy`. Do not pass `--impact` for season or
message cards. Supported Markdown is only `*emphasis*`, `**strong**`, inline
code, and safe links. Headings, lists, images, raw HTML, and line breaks are
rejected.

For an ordinary publication, omit `--id` and `--published-at`; the CLI creates a
date-and-title ID and uses the current timestamp. Records are immutable. A new
publication returns `"created": true`; an exact retry returns `"created": false`;
changed copy under the same ID is rejected. After publishing, run:

```sh
node AGENT-TEAM/scripts/player-updates.mjs list --limit 1 --json
```

Then verify `/updates/` contains the same card.

Publishing reads the dedicated bearer token from
`ELIXIR_DROP_UPDATES_PUBLISH_TOKEN` or the repository's mode-0600 `.env` and sends
it directly to the API over HTTPS. It needs no AWS profile or login, cannot deploy
code or write DynamoDB directly, and never prints the token. If the CLI reports
that the token is missing, stop and report the fixed-host setup problem; do not
substitute AWS credentials or put the token on the command line.

The material notification bar in `AGENTS.md` still applies, with silence as the
default. Final Free Pass selection and award, other prize action, and broad
messages remain subject to the human boundary.

## Issue policy

Issues are an exception ledger for multi-run work, external blockers, and Jamie
decisions. Same-run findings are fixed and verified without a routing ticket. Every
open issue has exactly one ownership label:

| Label | Owner |
|---|---|
| `objective:run` | Run Drop |
| `objective:grow` | Grow Drop |
| `objective:improve` | Improve Drop |
| `objective:season` | Call the Season |
| `objective:fair-play` | Protect Fair Play |

Work-type labels such as `bug`, `operations`, `growth`, `integrity`, `eval`, and
`enhancement` remain descriptive. They do not choose a worker. `decision` means Jamie
must answer before the objective can continue.

## Human and privacy boundary

- Do not send release mail, contact a player, announce a verdict, award a prize, or
  manufacture public traffic for acceptance.
- The Clash Royale token remains only on the allowlisted bridge host.
- Referee evidence remains private and pseudonymous. Never publish transcripts,
  player identifiers, correlation values, email, IP, or user-agent data.
- Visibility decisions use only the reversible referee overlay; never delete or edit
  canonical runs or scores.

## North star

Drop should remain a fast, fair, replayable game that teaches one useful Clash Royale
skill. Prefer measured outcomes over tickets, the smallest source fix over a guard,
and a healthy no-op over invented work.
