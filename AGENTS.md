# AGENTS.md — Elixir Drop

Canonical entry point for any agent working this repository. Read this, then the
doc it points you to for your task. The scheduled **AGENT-TEAM** maintainer roles
continue on from here (`AGENTS.md → AGENT-TEAM/WORKFLOW.md → AGENT-TEAM/README.md → your role`).

## What Drop is

Elixir Drop is a public web **game** for learning Clash Royale elixir costs, run by
the POAP KINGS. A Preact SPA deploys to **GitHub Pages** at `drop.poapkings.com`; a
**TypeScript Lambda** + one **DynamoDB** table back the player API; a fixed-IP
**Clash Royale API bridge** is the only sanctioned CR ingress.

## Doc map — the canonical one (read for your task)

Every other doc points back here instead of keeping its own copy of this list.

| Doc | What it owns |
| --- | --- |
| **`CLAUDE.md`** | The working guide: golden rules, architecture, product decisions. **The primary agent doc — read it before changing anything.** |
| **`SPEC.md`** | Current implementation spec: workspaces, data flow, storage inventory, analytics, deployment, referee evidence. |
| **`GAMES.md`** | Canonical games catalog (shipped / retired / backlog modes) and mechanic-level decisions. |
| **`CONTRIBUTING.md`** | Local development, **the `npm run verify` quality gate** (canonical), and repo conventions. |
| **`README.md`** | Public overview + local-development entry point. |
| **`RELEASES.md`** | The named-release history (no SemVer). Written by the Release Manager. |
| **`docs/card-rendering.md`** | Clash-style card rendering reference. |
| **`docs/beta-readiness.md`** | Pre-invite rollout checklist: automated gate vs. real-user checks. |
| **`infra/README.md`** | CloudFormation stack, bootstrap, and continuous deployment (canonical for CD mechanics). |
| **`services/api/README.md`** · **`services/cr-api-bridge/README.md`** | Backend and bridge workspace references. |
| **`AGENT-TEAM/`** | The scheduled maintainer roles: `WORKFLOW.md` (shared contract) → `README.md` (roster) → your role file. |

## Golden rules (full text in `CLAUDE.md` — do not violate)

1. Keep workspace boundaries explicit (`apps/web`, `services/api`, `services/cr-api-bridge`, `infra`).
2. Only the bridge calls the Clash Royale API at runtime; the browser and Lambda never do.
3. The CR token lives only on the managed, allowlisted host — never committed, never in CI or Lambda config.
4. The public website stays GitHub Pages + hash routing; `base: '/'`; the deploy build needs no secrets.
5. Vendor the look; don't link it. 6. Fan-content & copyright — keep the disclaimer.
7. Referee evidence is sanitized; decisions are a bounded overlay. `TELEMETRY_PEPPER` is Lambda-only.

## Stack & commands

- npm workspaces at the root; **Node 24**. `apps/web` = Preact + @preact/signals + Vite + TS.
- `npm run dev` · `npm run build` · **`npm run verify`** — run before pushing. What the gate
  actually runs is documented once, in `CONTRIBUTING.md` → "The quality gate".
- Transactional player email (magic links and the delivery canary) sends through **Fastmail JMAP** in `services/api/src/jmap.ts`. Bulk release notes publish through the dedicated **Buttondown** newsletter; neither path uses SES.

## Deploy model (canonical)

**One pipeline ships both surfaces.** Pushing to `main` runs
`.github/workflows/deploy.yml`, which verifies the monorepo, runs `npm run deploy:api`
to update the Lambda/CloudFormation stack, smokes the deployed API, rebuilds the web
bundle against the endpoint that stack emitted, and only then publishes GitHub Pages.
A failed API update blocks the website deploy, so web and Lambda cannot diverge.

- There is **no manual handoff for an ordinary backend change** — the same push that
  commits it deploys it.
- `npm run deploy:api` stays the **Operations Manager's** out-of-band tool: first stack
  creation, secret rotation, and re-running a deploy that CI could not complete. It is
  run from the fixed host with the mode-0600 root `.env`.
- `needs-deploy` therefore means "the pipeline did not run or did not finish" — not
  "backend changes always wait for a human". See `infra/README.md` for the CD mechanics.

## Work tracking

GitHub Issues on this repository are the canonical work queue. **Work commits directly to
`main`** — no feature branches, no PR-based review — referencing `Closes #N`. The full
contract is `AGENT-TEAM/WORKFLOW.md`. (Outside contributors without push access open a PR
from a fork; `.github/workflows/verify.yml` gates it. See `CONTRIBUTING.md`.)
