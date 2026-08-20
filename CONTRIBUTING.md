# Contributing to Elixir Drop

Elixir Drop is a small web game for learning Clash Royale elixir costs, run by
the POAP KINGS clan. Contributions are welcome — bug fixes, new game modes,
accessibility improvements, and polish especially.

By contributing you agree that your contributions are licensed under the
project's [MIT License](./LICENSE). Note the license's third-party-assets
carve-out: Clash Royale art and data are Supercell's under the Fan Content
Policy and are not yours (or ours) to relicense.

## Prerequisites

- **Node 24** (the authoritative version) and npm.
- For end-to-end tests: `npx playwright install` (Chromium, Firefox, WebKit).

## Quick start

```bash
git clone https://github.com/jthingelstad/drop.poapkings.com.git
cd drop.poapkings.com
npm install
npm run dev            # Vite dev server at http://localhost:5173
npm run dev:qa         # same server, without production-version update notices
```

The repo ships a committed `packages/game-data/cards.json` snapshot and mirrored
card art, so the **UI runs locally with no API key and no secrets** — you can
browse Home, open every game's ready screen, view leaderboards, and trigger the
screensaver without signing in.

### How the local app talks to the backend

There is currently **no local API stack**. `apps/web/public/api-config.json`
points the dev server at the **deployed production API**. That means:

- Browsing and most UI work need no sign-in and touch nothing.
- **Signing in (magic link) and recording games hit the live backend and create
  real data.** If you need to test the signed-in flow, use a throwaway email
  address, and delete the account afterward from the profile page.
- Recorded gameplay always requires a signed server challenge. When the browser
  is offline, every mode can deal locally, but that run is never submitted,
  queued, ranked, or applied to account progress.

Running the API (a TypeScript Lambda + DynamoDB) fully locally is not wired up
yet; a local emulation path (e.g. SAM + dynamodb-local) is a welcome future
contribution. Until then, the real inner loop for game logic, scoring, and
storage is the **test suite**, which mocks the API end to end.

For visual QA against that deployed API, use `npm run dev:qa`. It sets
`VITE_DISABLE_UPDATE_NOTICE=1` for that local Vite process so a deliberate
local/production build mismatch does not cover or reflow the screen under test.
The normal dev command, production builds, and the stale-installed-app tests
leave update notices enabled.

## The quality gate

**This section is the canonical description of the gate.** Other docs point here
rather than repeating the list — if you change what `verify` runs, change it here.

**Match the local gate to what you changed.** Re-running the complete remote
matrix locally on every change spent minutes without improving the deployment
decision. The push gate remains authoritative; local work should prove the
changed surface and finish with the smallest final gate below.

| What the commit touches | Run |
| --- | --- |
| Routine web/gameplay/layout work | `npm run verify:quick` |
| API, infrastructure, bridge, or Control Room only | `npm run verify:non-browser` |
| E2E test only | the changed Playwright spec/project, then `npm run verify:non-browser` |
| Root `scripts/`, `.claude/`, `AGENT-TEAM/`, `docs/`, root `*.md` | `npm run verify:non-browser` |
| Offline/service-worker behavior, browser test infrastructure, cross-engine fixes, broad release QA | `npm run verify` |
| Unsure | `npm run verify` |

`npm run verify:quick` is the routine web pre-push gate: full non-browser
verification, the complete Chromium suite, and the tagged deployment smoke in
Firefox, WebKit, and iPhone 14. `npm run verify` is the exhaustive version; it
runs every test in all four projects and is intentionally reserved for the
high-risk cases in the table. `npm run test:e2e:deploy` reproduces just the
browser portion of the main deployment gate.

It runs, across every implemented workspace: Prettier format check, oxlint
(warnings fail), the objective-team
contract test (`test:agent-team`), the CI-scope contract tests, Stylelint,
TypeScript typecheck, Knip (unused code/deps), Vitest unit tests with coverage
thresholds, Playwright e2e, and a production build.

CI divides validation from mutation so obsolete checks can be cancelled without
interrupting a CloudFormation or Pages deployment:

- **`validate-main.yml`** on a push to `main` — non-browser verification always
  runs. Player-reachable changes add two full Chromium shards plus the tagged
  `@deploy` smoke in Firefox, desktop WebKit, and iPhone WebKit. A newer push
  cancels an obsolete validation and reclassifies the cumulative change since
  the last successful production run.
- **`deploy.yml`** starts only after `Validate Main` succeeds. It downloads that
  exact scope, requires the validated SHA still to be `main`, serializes
  production mutation, and deploys only the affected surface.
- **`verify.yml`** runs the exhaustive four-project suite on every pull request,
  every manual dispatch, and once daily. It is fork-safe and is the regression
  backstop for combinations intentionally removed from the per-push gate.

The classifier is tested code in `scripts/classify-ci-scope.mjs`. API and
infrastructure changes deploy and smoke the Lambda without rebuilding or
publishing Pages. A web change updates the API first because `WEB_VERSION` is a
referee-evidence boundary, then builds and publishes Pages from the endpoint the
stack emitted. Test-only, fixed-host, tooling, and prose changes validate but do
not republish unrelated public surfaces. Unknown paths take the full fail-safe
path; manual `workflow_dispatch` also deploys both surfaces.

Tests tagged `@deploy` should cover a critical player journey, a known
engine-specific regression, or a production boundary such as offline fallback
or run recording. Do not tag broad visual inventories or long exhaustive loops
only to increase the count: full Chromium and the daily matrix already own
those. A deployment-tag change must be exercised locally with
`npm run test:e2e:deploy`.

Both validation workflows also run `npm audit --audit-level=high` ahead of the
gate; that audit is not part of `npm run verify` itself (`npm run check:beta`
bundles the two locally). Root `npm run verify` remains the complete sequential
pre-push command; `verify:quick` is the normal web command, and
`verify:non-browser` is the complete gate for changes with no browser runtime.

Handy sub-commands while iterating:

```bash
npm run format             # auto-fix formatting
npm run lint               # oxlint only
npm run typecheck          # types only
npm run test:unit          # unit tests only (fast)
npm run test:e2e           # Playwright e2e
npm run verify:non-browser # complete gate except Playwright
```

## Repository layout & boundaries

- `apps/web` — the Preact + Vite browser game (GitHub Pages, hash routing).
- `apps/admin` — the desktop-first private Control Room (managed host + tailnet).
- `services/api` — the TypeScript Lambda backend (DynamoDB, API Gateway).
- `services/admin` — the loopback-only adapter over sanctioned referee scripts.
- `services/cr-api-bridge` — the fixed-IP Clash Royale API worker.
- `packages/contracts` — shared request/response types.
- `packages/game-data` — the committed `cards.json` snapshot.
- `infra` — CloudFormation.

These boundaries are enforced by the project's **golden rules** — the full text
lives in [`CLAUDE.md`](./CLAUDE.md) and is the one place they are stated. The two
that bite contributors most: do not import service implementation files across
workspaces, and **only the bridge may call the Clash Royale API at runtime**.

## Conventions

- **Match the surrounding code** — its naming, idioms, and comment density.
- **Glyphs** come from lucide-static via `apps/web/src/components/Icon.tsx`; don't
  hand-type arrows or symbols.
- **Card UI** uses `apps/web/src/components/CardChrome.tsx` and
  `lib/card-rendering.ts`; don't hand-roll card art/name/cost.
- **Honor reduced motion** (both the OS setting and the in-app toggle) for any
  animation.
- **Add or update tests** when you change shared logic, scoring, storage, or
  mobile gameplay controls.
- **Update the docs** when you make a product or architecture decision:
  `GAMES.md` for mechanics, `SPEC.md` for architecture, `CLAUDE.md` for the
  working guide. [`AGENTS.md`](./AGENTS.md) holds the canonical doc map.
- **No curated deck data.** New modes work from `cards.json` facts only — no
  `decks.json`, archetype lists, or "real deck" dependencies. The rationale is in
  [`GAMES.md`](./GAMES.md) → "Current product constraint".

## How changes land

This repository **commits directly to `main`** — no feature branches and no
PR-based review. That is the stated convention for maintainers and for the
scheduled `AGENT-TEAM/` roles (`AGENTS.md` → "Work tracking"), and it is what the
history shows. `main` is protected by the gate, not by review: `Validate Main`
must succeed before the exact validated head can enter the serialized
deployment workflow.

If you do not have push access, the fork-and-pull-request path is the way in:

- Fork, branch in your fork, keep the change focused, and describe what and why.
- `.github/workflows/verify.yml` runs the same gate on your PR, with no secrets.
- Run the local gate from the table above; CI supplies the authoritative remote
  matrix.
- Screenshots or a short clip help for any visual change.

## Reporting bugs & ideas

Open a GitHub issue, or bring it to the
[Elixir Drop Discord](https://discord.gg/SdvKfJW5kA). Include steps to
reproduce, what you expected, and what happened (browser/device helps).

Thanks for helping people learn their elixir costs a little faster. ⚡
