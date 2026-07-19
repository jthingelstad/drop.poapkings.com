# Elixir Drop

A fast little game for learning **Clash Royale cards and elixir costs**, run by
the **POAP KINGS** clan. See a card, name it or price it, get quicker. Built as
as a static single-page app in the Elixir Drop monorepo.

**Play:** [drop.poapkings.com](https://drop.poapkings.com)

---

## What it is

Five ways to play at launch, one card-cost engine:

- **Surge** — the flagship speed game. A 15-card sprint against the clock; wrong
  answers add a time penalty. Your score is your time, lower is better.
- **Practice** — untimed, unranked cost recall. A card appears, you pick its
  elixir cost. True practice: never touches a leaderboard.
- **Higher / Lower** — two cards, pick which costs more. Trains the relative read
  that wins elixir trades.
- **Trade** — Blue King vs. Red King elixir math across eight exchanges.
- **Survival** — sudden death; one miss or timeout ends the run, and the clock
  tightens as your streak grows.

Five more finished modes (Identify, Blitz, Speed Ladder, Endless Ladder, Cost
Sweep) are vaulted for post-launch re-release drops — see `GAMES.md`.

See [`GAMES.md`](GAMES.md) for the full mode catalog, retired modes, and backlog
of game ideas. See [`docs/card-rendering.md`](docs/card-rendering.md) for the
shared Clash-style card-rendering rules used by the modes.

Every game deals from a signed server challenge drawn from the complete card
catalog, and a short end-of-session insight ("you bleed time on 5–6 cost
cards") turns the game into a coach rather than a quiz. Linked Clash Royale
collections remain visible on player profiles but do not change the deal.
**Elixir**, the clan's mascot, hosts.

It's also a quiet front door to the clan: a good run is met with an invite, not
a banner.

---

## Tech

- `apps/web` — the current **Preact** + **@preact/signals** website, built with
  **Vite** and TypeScript and deployed to GitHub Pages.
- `services/api` — the TypeScript Lambda backend for email authentication,
  player profiles, signed game runs, progression, seasonal leaderboards, and
  notable Discord events.
- `services/cr-api-bridge` — the TypeScript queue worker running on this fixed,
  Clash Royale API-allowlisted host. It relays player snapshots and the live
  Clan Wars season clock.
- `packages/contracts` and `packages/game-data` — shared TypeScript API contracts
  and the canonical Clash Royale card snapshot.
- `infra` — CloudFormation plus AWS SDK bootstrap/deployment automation.

Every player signs in with an email magic link and every game starts from a
signed server challenge. The app never falls back to an anonymous or locally
sampled run when player services are unavailable. Local display and input
preferences stay in **localStorage**; game history, player levels, profiles, the
global Trophy Road, and leaderboards live in DynamoDB. Trophy Road began at a
one-time launch seed of 592 and advances exactly once for every server-accepted
completed game; page views and Tinylytics analytics never contribute to it.
Each signed-in player chooses a favorite Clash Royale card as their profile
image and selects a safe, playful name inspired by that card, including its
community nicknames and character.

---

## Local development

```bash
npm install
npm run dev       # Vite dev server
npm run verify    # verify every implemented workspace
npm run build     # build every implemented workspace
npm run preview   # serve the build locally
npm run check:beta # full quality gate plus production API smoke
```

The root commands use npm workspaces. The repo ships with a committed
`packages/game-data/cards.json` snapshot, so the game
runs fully offline in dev — no API key required to develop.

Elixir Drop intentionally does **not** maintain curated deck definitions,
archetype data, or "real deck" dependencies. New modes should work from the
committed card facts in `cards.json` instead of requiring a separate
`decks.json` dataset.

---

## Card data

This is the one non-obvious part.

All card facts (name, elixir cost, rarity, type, art URL) come from the official
**Clash Royale API** `/cards` endpoint. But the running game and CI **never call
the API**, for two reasons:

1. The API can't be called from a browser (CORS).
2. The developer token is **IP-allowlisted**, so it can't run from CI runners
   either (dynamic IPs).

So card data is refreshed out-of-band and **committed to the repo**:

- A checkout lives on a host whose IP is registered with the token.
- The token sits in `.env` there (`CR_API_KEY`) — **gitignored**, never committed.
- A cron job (or manual run) executes
  `node apps/web/scripts/refresh-cards.mjs`, which fetches `/cards`, normalizes
  it, **diffs** against the committed snapshot, and **commits only when something
  changed** (printing a changelog of new/changed/removed cards).
- That push triggers the GitHub Actions build + deploy. The Pages build only ever
  reads the committed `cards.json` — so the token stays off CI entirely.

Card art is mirrored same-origin under `apps/web/public/cards/` and preloaded
before timed runs. The refresh script always runs with `MIRROR_IMAGES=true`
on the managed host (kept in its `.env`); a bare refresh would revert the
snapshot to hotlinked CDN URLs, which the page CSP blocks for WebGL texture
use and which reintroduces a CDN dependency for gameplay art.

The application backend does not call the Clash Royale API directly. It writes
tag refresh work to SQS. `services/cr-api-bridge` long-polls that queue from this
allowlisted host, calls `/players/{tag}`, and puts a narrow result on a second
queue. A result Lambda stores the player's CR name, clan, Years Played badge
day count (used to calculate account age), and card collection without
competitive fields or card levels. Saving a tag fetches its first snapshot.
Later snapshots refresh only when the player completes a new magic-link login;
routine session restoration, profile reads, and games use cached data without
creating bridge work.

The bridge also reads POAP KINGS' `/currentriverrace` and `/riverracelog` every
five minutes. It sends CR's sequential season ID, section/week, period/day, and
phase through the existing result queue. The API stores one current clock and
uses it to partition completed runs, reset leaderboards, and show the current
war week. The existing first-Monday 10:00 UTC calculation remains only as a
fallback when the bridge clock is stale.

---

## Deploy

GitHub Pages, custom domain `drop.poapkings.com`:

- `apps/web/public/CNAME` contains the domain; Vite `base` is `/` (custom domain
  serves from root).
- `.github/workflows/deploy.yml` builds and deploys on push to `main`.
- "Enforce HTTPS" is on once the certificate provisions.

The API is a separate production CloudFormation stack:

```bash
npm run bootstrap:aws  # one time: IAM deploy user, role, bucket, root .env
npm run deploy:api     # SDK-based build, upload, stack update, web API config
```

Before inviting a new beta group, follow
[`docs/beta-readiness.md`](docs/beta-readiness.md). It separates automated
release gates from the few real-user checks that should not be faked in CI.

Bootstrap copies the existing Fastmail JMAP and CR tokens into the gitignored
root `.env`, generates a Drop-specific signing secret, and creates separate
access credentials for the limited `elixir-drop` deploy user and the even
narrower `elixir-drop-cr-bridge` queue user. Routine deployment and bridge work
use the AWS SDK and do not invoke the AWS CLI.

On the allowlisted Mac, install the built worker as a persistent launch agent:

```bash
npm run install:launchd --workspace=@elixir-drop/cr-api-bridge
```

---

## Project structure

```
elixir-drop/
├─ apps/
│  └─ web/                   # current public Preact/Vite application
│     ├─ public/             # CNAME and static assets
│     ├─ src/                # modes, components, screens, and browser libraries
│     ├─ scripts/            # card refresh and OG image maintenance
│     └─ tests/              # unit and browser coverage
├─ services/
│  ├─ api/                   # TypeScript Lambda API backend
│  └─ cr-api-bridge/         # fixed-IP TypeScript Clash Royale API worker
├─ packages/
│  ├─ contracts/             # browser/server TypeScript contracts
│  └─ game-data/             # canonical cards.json snapshot
├─ infra/                    # CloudFormation and SDK deployment scripts
├─ package.json              # npm workspace commands
├─ .github/workflows/deploy.yml
├─ SPEC.md                   # current implementation spec and constraints
├─ GAMES.md                  # canonical games catalog + idea backlog
├─ docs/card-rendering.md    # shared card rendering reference
└─ CLAUDE.md                 # agent guide for future code work
```

The Clash Royale API reference under `docs/cr-agent-api-docs/` is source material
for the static card refresher and bridge normalization; it is not an API design.
The Clash Royale screenshots under `docs/clash-royale-screenshots/` are visual
reference for the shared card chrome, not runtime assets.

---

## Credits & fan content

Run by [POAP KINGS](https://poapkings.com) (clan tag `#J2RGCRVG`).

This is an unofficial fan project. Clash Royale card data, names, and artwork are
© Supercell, used under
[Supercell's Fan Content Policy](https://www.supercell.com/fan-content-policy).
Not endorsed by Supercell. Non-commercial.
