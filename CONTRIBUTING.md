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
- There is no anonymous/offline fallback for *recorded gameplay* — the game
  refuses to deal a run without a signed server challenge.

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

Before pushing, this must pass:

```bash
npm run verify
```

It runs, across every implemented workspace: Prettier format check, oxlint
(warnings fail), the release-tooling test (`test:release`), Stylelint, TypeScript
typecheck, Knip (unused code/deps), Vitest unit tests with coverage thresholds,
Playwright e2e across **Chromium / Firefox / WebKit / iPhone-14**, and a
production build.

CI runs the same checks in two places, both defined in `.github/workflows/`.
To keep the complete gate without serializing four browser engines on one
runner, each workflow splits the work into one non-browser job and four
parallel Playwright jobs (Chromium, Firefox, WebKit, and iPhone 14):

- **`verify.yml`** on every pull request — all five jobs run without secrets, so
  the gate is fork-safe by construction.
- **`deploy.yml`** on every push to `main` — API and Pages deployment waits for
  all five jobs, and any failure stops both surfaces from deploying.

Both workflows also run `npm audit --audit-level=high` ahead of the gate; that
audit is not part of `npm run verify` itself (`npm run check:beta` bundles the
two locally). Root `npm run verify` remains the complete sequential pre-push
command; `npm run verify:non-browser` is the fast CI/local subset when browser
coverage is running separately.

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
- `services/api` — the TypeScript Lambda backend (DynamoDB, API Gateway).
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
history shows. `main` is protected by the gate, not by review: the push-to-main
workflow runs `npm run verify` before it deploys anything.

If you do not have push access, the fork-and-pull-request path is the way in:

- Fork, branch in your fork, keep the change focused, and describe what and why.
- `.github/workflows/verify.yml` runs the same gate on your PR, with no secrets.
- Make sure `npm run verify` is green locally first — CI will run it again.
- Screenshots or a short clip help for any visual change.

## Reporting bugs & ideas

Open a GitHub issue, or bring it to the
[Elixir Drop Discord](https://discord.gg/SdvKfJW5kA). Include steps to
reproduce, what you expected, and what happened (browser/device helps).

Thanks for helping people learn their elixir costs a little faster. ⚡
