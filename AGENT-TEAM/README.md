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

- `AGENTS.md` and `CLAUDE.md` are the repository and architecture sources of truth.
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
- `apps/web/src/data/updates/` holds the three static player-message streams. Every
  owner authors a concise `features.json` entry with a player-visible change; Grow
  Drop also audits deployed commits daily for omissions. Call the Season owns routine,
  factual `seasons.json` checkpoints. Final Free Pass selection and award, other prize
  action, and broad messages remain subject to the human boundary.

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
