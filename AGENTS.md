# AGENTS.md — Elixir Drop

Canonical entry point for any agent working this repository. Read this, then the
doc it points you to for your task. The **AGENT-TEAM** maintainer roles
continue on from here (`AGENTS.md → AGENT-TEAM/WORKFLOW.md → AGENT-TEAM/README.md → your role`).

## What Drop is

Elixir Drop is a public web **game** for learning Clash Royale elixir costs, run by
the POAP KINGS. A Preact SPA deploys to **GitHub Pages** at `drop.poapkings.com`; a
**TypeScript Lambda** + one **DynamoDB** table back the player API; a fixed-IP
**Clash Royale API bridge** is the only sanctioned CR ingress.

## Doc map — the canonical one (read for your task)

Every other doc points back here instead of keeping its own copy of this list.

| Doc                                                                   | What it owns                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`CLAUDE.md`**                                                       | The working guide: golden rules, architecture, product decisions. **The primary agent doc — read it before changing anything.** |
| **`SPEC.md`**                                                         | Current implementation spec: workspaces, data flow, storage inventory, analytics, deployment, referee evidence.                 |
| **`GAMES.md`**                                                        | Canonical games catalog (shipped / retired / backlog modes) and mechanic-level decisions.                                       |
| **`CONTRIBUTING.md`**                                                 | Local development, **the `npm run verify` quality gate** (canonical), and repo conventions.                                     |
| **`README.md`**                                                       | Public overview + local-development entry point.                                                                                |
| **`docs/card-rendering.md`**                                          | Clash-style card rendering reference.                                                                                           |
| **`docs/beta-readiness.md`**                                          | Pre-invite rollout checklist: automated gate vs. real-user checks.                                                              |
| **`docs/referee-visibility.md`**                                     | Superseded design note: the reasoning behind the player-facing referee seal. Read `SPEC.md` §11 for what shipped.               |
| **`docs/desktop-keyboard.md`**                                       | Assessment + proposal: keyboard support on desktop, and why unlocking ranked play there is a board decision, not a bindings one. |
| **`infra/README.md`**                                                 | CloudFormation stack, bootstrap, and continuous deployment (canonical for CD mechanics).                                        |
| **`services/api/README.md`** · **`services/cr-api-bridge/README.md`** · **`services/admin/README.md`** | Backend, bridge, and private Control Room service references.                                                                    |
| **`AGENT-TEAM/`**                                                     | Objective owners: `WORKFLOW.md` (operating contract) → `README.md` (objectives) → the selected objective file.                  |
| **`AGENT-TEAM/fair-play-policy.md`**                                 | Durable Fair Play evidence, disposition, and visibility rubric.                                                                 |
| **`apps/web/src/data/updates/`**                                      | Player-facing feature, season, and message history merged into the Updates tab and public archive.                             |

## Golden rules (full text in `CLAUDE.md` — do not violate)

1. Keep workspace boundaries explicit (`apps/web`, `apps/admin`, `services/api`, `services/admin`, `services/cr-api-bridge`, `infra`).
2. Only the bridge calls the Clash Royale API at runtime; the browser and Lambda never do.
3. The CR token lives only on the managed, allowlisted host — never committed, never in CI or Lambda config.
4. The public website stays GitHub Pages + hash routing; `base: '/'`; the deploy build needs no secrets.
5. Vendor the look; don't link it.
6. Fan-content & copyright — keep the disclaimer.
7. Referee evidence is sanitized; decisions are a bounded overlay. `TELEMETRY_PEPPER` is Lambda-only.

## Stack & commands

- npm workspaces at the root; **Node 24**. `apps/web` = Preact + @preact/signals + Vite + TS.
- `npm run dev` · `npm run build` · `npm run verify:quick` · `npm run verify` —
  use the change-specific pre-push gate in `CONTRIBUTING.md` → "The quality gate".
- Transactional player email sends from `elixir@poapkings.com` through **Fastmail
  JMAP** in `services/api/src/jmap.ts`; magic links keep that recognizable sender.
  `drop@poapkings.com` is the monitored administrative/general-contact address
  for alarms, the delivery-canary recipient, privacy questions, and Fair Play
  disputes. Bulk release notes publish through the dedicated **Buttondown**
  newsletter; none of these paths uses SES.

## Deploy model (canonical)

**Validation is replaceable; deployment is serialized.** Pushing to `main` runs
`.github/workflows/validate-main.yml`. A newer push cancels an obsolete validation,
and the replacement validates the cumulative change since the last successful
production run. A successful exact-head validation triggers
`.github/workflows/deploy.yml`.

- API/infra changes deploy and smoke the Lambda without rebuilding Pages.
- Web/shared changes update the API's referee `WEB_VERSION`, smoke it, rebuild the
  web bundle against the emitted endpoint, and only then publish GitHub Pages.
- Tests, fixed-host services, tooling, and prose validate without republishing an
  unrelated public surface. Unknown paths and manual deploys take the full path.
- Content-addressed Lambda bundles make unchanged code a CloudFormation no-op.

- There is **no manual handoff for an ordinary backend change** — the same push that
  commits it deploys it.
- `npm run deploy:api` stays **Run Drop's** out-of-band tool: first stack
  creation, secret rotation, and re-running a deploy that CI could not complete. It is
  run from the fixed host with the mode-0600 root `.env`.
- A pipeline that did not run or finish is a Run Drop finding, not a routine manual
  handoff. See `infra/README.md` for the CD mechanics.

## Work tracking

GitHub Issues are the durable exception ledger for multi-run work, external blockers,
and Jamie decisions. Objective owners fix clear same-run gaps directly. **Work commits
directly to `main`** — no feature branches or PR-based review. The full contract is
`AGENT-TEAM/WORKFLOW.md`. (Outside contributors without push access open a PR
from a fork; `.github/workflows/verify.yml` gates it. See `CONTRIBUTING.md`.)

Player-visible work ships with one concise entry in
`apps/web/src/data/updates/features.json`: a subject and one Markdown paragraph, written for
players with Clash energy. Do not announce refactors, tests, dependencies, deploys,
observability, admin tools, or maintenance. Season results belong in `seasons.json`; other
player messages belong in `messages.json`. Call the Season may publish routine, source-backed
current leaders and Cleared final game results in `seasons.json`; naming the Free Pass
recipient, awarding any prize, or sending broad communication still requires Jamie's
authority. Grow Drop audits deployed changes daily for missed feature entries. There are no
named releases.
