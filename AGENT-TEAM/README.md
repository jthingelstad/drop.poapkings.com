# AGENT-TEAM — objective owners for Elixir Drop

Three objective owners maintain Drop. Each owns a durable outcome through
measurement, implementation, verification, deployment acceptance, and natural
product acceptance. There is no Build Manager, Team Manager, or routing pipeline.

## The team

| Objective | File | Cadence | Primary question |
|---|---|---|---|
| **Run Drop** | `run-drop.md` | Weekly and after incidents/deploys | Is the public game healthy, correct, current, observable, and inexpensive to run? |
| **Grow Drop** | `grow-drop.md` | Weekly and at season boundaries | Are more people reaching a first run, returning, and finding the seasons worth playing? |
| **Protect Fair Play** | `protect-fair-play.md` | Weekly and before prize/result decisions | Are ranked results trustworthy and are uncertain cases handled privately, reversibly, and from exact evidence? |

Building and testing are capabilities of every objective owner. New modes, material
scoring or season changes, privacy-affecting signals, public accusations, prize
decisions, and other large member-visible direction still belong to Jamie.

The former five-role queue and weekly Manager are retired. Git history and
`summaries/` preserve that period. The Fair Play objective remains independently
bounded: it may repair established tooling or scoring defects from sanitized,
synthetic evidence, but it may never alter a live case, canonical run, or threshold
to obtain a preferred verdict.

## Project map

- `AGENTS.md` and `CLAUDE.md` are the repository and architecture sources of truth.
- `SPEC.md` owns the implemented product/data contract; `GAMES.md` owns mode and
  scoring decisions.
- `npm run verify` is the canonical source gate.
- `AGENT-TEAM/scripts/objective-lease.mjs` serializes mutating objective runs in the
  shared checkout.
- `.github/workflows/deploy.yml` ships Lambda and Pages together from `main`.
- `AGENT-TEAM/scripts/referee-*.mjs` are the sanctioned referee read/decision path.
- `AGENT-TEAM/fair-play-policy.md` is the durable evidence and decision rubric.
- `.claude/skills/cut-release/` is a user-triggered named-release ceremony, not an
  objective or scheduled activity.

## Issue policy

Issues are an exception ledger for multi-run work, external blockers, and Jamie
decisions. Same-run findings are fixed and verified without a routing ticket. Every
open issue has exactly one ownership label:

| Label | Owner |
|---|---|
| `objective:run` | Run Drop |
| `objective:grow` | Grow Drop |
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
