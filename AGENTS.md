# AGENTS.md — Elixir Drop

Canonical entry point for any agent working this repository. Read this, then the
doc it points you to for your task. The scheduled **AGENT-TEAM** maintainer roles
continue on from here (`AGENTS.md → AGENT-TEAM/WORKFLOW.md → AGENT-TEAM/README.md → your role`).

## What Drop is

Elixir Drop is a public web **game** for learning Clash Royale elixir costs, run by
the POAP KINGS. A Preact SPA deploys to **GitHub Pages** at `drop.poapkings.com`; a
**TypeScript Lambda** + one **DynamoDB** table back the player API; a fixed-IP
**Clash Royale API bridge** is the only sanctioned CR ingress.

## Source of truth (read for your task)

- **`CLAUDE.md`** — the working guide: golden rules, architecture, product decisions. **The primary agent doc — read it before changing anything.**
- **`SPEC.md`** — current implementation spec and product constraints.
- **`GAMES.md`** — canonical games catalog (shipped / retired / backlog modes).
- **`README.md`** — public overview + local-development entry point.
- **`docs/card-rendering.md`** — Clash-style card rendering reference.

## Golden rules (full text in `CLAUDE.md` — do not violate)

1. Keep workspace boundaries explicit (`apps/web`, `services/api`, `services/cr-api-bridge`, `infra`).
2. Only the bridge calls the Clash Royale API at runtime; the browser and Lambda never do.
3. The CR token lives only on the managed, allowlisted host — never committed, never in CI or Lambda config.
4. The public website stays GitHub Pages + hash routing; `base: '/'`; the deploy build needs no secrets.
5. Vendor the look; don't link it. 6. Fan-content & copyright — keep the disclaimer.
7. Referee evidence is sanitized; decisions are a bounded overlay. `TELEMETRY_PEPPER` is Lambda-only.

## Stack & commands

- npm workspaces at the root; **Node 24**. `apps/web` = Preact + @preact/signals + Vite + TS.
- `npm run dev` · `npm run build` · **`npm run verify`** (format, lint, CSS lint, typecheck, Knip, unit, Chromium e2e, prod build) — run before pushing.
- **Deploy model:** pushing to `main` triggers CI (`verify:deploy`) which builds and deploys the **frontend to Pages automatically** — no manual step. The **Lambda API deploys separately** via `npm run deploy:api` (SDK-based); backend changes are not live until that runs (that is the `needs-deploy` handoff to the Operations Manager).
- Player-email (magic links **and** release notes) sends through the **Fastmail JMAP** path in `services/api/src/jmap.ts` (`FASTMAIL_JMAP_TOKEN`), not SES.

## Work tracking

GitHub Issues on this repository are the canonical work queue; work commits directly
to `main` referencing `Closes #N`. The full contract is `AGENT-TEAM/WORKFLOW.md`.
