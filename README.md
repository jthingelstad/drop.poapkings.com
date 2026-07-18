# Elixir Drop

A fast little game for learning **Clash Royale cards and elixir costs**, run by
the **POAP KINGS** clan. See a card, name it or price it, get quicker. Built as
as a static single-page app in the Elixir Drop monorepo.

**Play:** [drop.poapkings.com](https://drop.poapkings.com)

---

## What it is

Ten ways to play, one card-cost engine:

- **Surge** — the flagship speed game. A 15-card sprint against the clock; wrong
  answers add a time penalty. Your score is your time, lower is better.
- **Practice** — untimed cost recall. A card appears, you pick its elixir cost.
- **Identify** — card art appears with the name hidden. Pick the right name from
  six choices.
- **Higher / Lower** — two cards, pick which costs more. Trains the relative read
  that wins elixir trades.
- **Trade** — Blue King vs. Red King elixir math across eight exchanges.
- **Blitz** — 60 seconds of cost recall; clear as many cards as possible.
- **Survival** — sudden death; one miss or timeout ends the run.
- **Speed Ladder** — sort five cards from lowest elixir to highest.
- **Endless Ladder** — insert each new card into a growing low-to-high row.
- **Cost Sweep** — tap every card in a grid that matches the target elixir cost.

See [`GAMES.md`](GAMES.md) for the full mode catalog, retired modes, and backlog
of game ideas. See [`docs/card-rendering.md`](docs/card-rendering.md) for the
shared Clash-style card-rendering rules used by the modes.

A weighted sampler surfaces the cards you miss more often, and a short
end-of-session insight ("you bleed time on 5–6 cost cards") turns the game into
a coach rather than a quiz. **Elixir**, the clan's mascot, hosts.

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
  Clash Royale API-allowlisted host.
- `packages/contracts` and `packages/game-data` — shared TypeScript API contracts
  and the canonical Clash Royale card snapshot.
- `infra` — CloudFormation plus AWS SDK bootstrap/deployment automation.

The website remains playable if the backend is unavailable. Local card-learning
statistics stay in **localStorage**; authenticated game history, player levels,
profiles, global Trophy Road totals, and leaderboards live in DynamoDB.
Each signed-in player chooses a favorite Clash Royale card as their profile
image and selects a safe public name generated from that card's title.

---

## Local development

```bash
npm install
npm run dev       # Vite dev server
npm run verify    # verify every implemented workspace
npm run build     # build every implemented workspace
npm run preview   # serve the build locally
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

Card art is hotlinked from Supercell's CDN (`api-assets.clashroyale.com`) and
preloaded before timed runs. A `MIRROR_IMAGES` flag in the refresh script can
download art locally instead, with no game-code change.

The application backend does not call the Clash Royale API directly. It writes
tag refresh work to SQS. `services/cr-api-bridge` long-polls that queue from this
allowlisted host, calls `/players/{tag}`, and puts a narrow result on a second
queue. A result Lambda stores the player's CR name, clan, Years Played badge
day count (used to calculate account age), and card collection without
competitive fields or card levels. The profile
serves cached data while snapshots older than six hours refresh in the
background.

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
