# Elixir Drop

A fast little game for learning **Clash Royale cards and elixir costs**, run by
the **POAP KINGS** clan. See a card, name it or price it, get quicker. Built as
as a static single-page app in the Elixir Drop monorepo.

**Play:** [drop.poapkings.com](https://drop.poapkings.com)

**Contact:** [drop@poapkings.com](mailto:drop@poapkings.com) for questions,
privacy requests, and Fair Play re-review. Player magic links are sent from
`elixir@poapkings.com`.

---

## What it is

Six ways to play, one card-cost engine:

- **Surge** — the flagship speed game. A 15-card sprint against the clock; wrong
  answers add a time penalty. Your score is your time, lower is better.
- **Practice** — untimed, endless cost recall, weighted toward the cards you keep
  getting wrong. A card appears, you pick its elixir cost, and you stop when you
  want. True practice: no score, no record, no XP, never a leaderboard.
- **Higher / Lower** — two cards, pick which costs more, on three lives. The gap
  between the two costs narrows as you go. Trains the relative read that wins
  elixir trades.
- **Trade** — Blue King vs. Red King elixir math across ten exchanges, on a fixed
  board ladder that opens with 1v1 reads and ends 3v3.
- **Survival** — sudden death; one miss or timeout ends the run, and the clock
  tightens as your streak grows.
- **Rain** — falling cards, three lives, and a cost keypad. Clear the lit card
  before it lands as the field accelerates.

See [`GAMES.md`](GAMES.md) for the full mode catalog, retired modes, and backlog
of game ideas. See [`docs/card-rendering.md`](docs/card-rendering.md) for the
shared Clash-style card-rendering rules used by the modes.

Official online games deal from a signed server challenge drawn from the
complete card catalog. Offline, the same shared deal rules run locally and the
result is never saved, ranked, or applied to account progress. A short
end-of-session insight ("you bleed time on 5–6 cost cards") turns the game into
a coach rather than a quiz. A linked Clash Royale collection is stored but not
rendered; only the card count is shown, and it does not change the deal.

It's also a quiet front door to the clan: a persistent "Run by POAP KINGS"
footer link and a Discord link, never a banner or a pop-up.

Ranked play is human play: a person chooses every answer. Strict new leaders and
technically unusual results can wait for referee review before placement, with
visible `🔎 Pending`, `✅ Reviewed`, and `🚫 Excluded` status. The standalone
Fair Play page explains allowed settings and accessibility tools, prohibited
automation, private review, and re-review.

---

## Tech

- `apps/web` — the current **Preact** + **@preact/signals** website, built with
  **Vite** and TypeScript and deployed to GitHub Pages.
- `apps/admin` + `services/admin` — the private, tailnet-only **Drop Control
  Room**, its loopback referee adapter, and a separate audited account-support
  adapter. It is never deployed to Pages.
- `services/api` — the TypeScript Lambda backend for email authentication,
  player profiles, signed game runs, progression, seasonal leaderboards, and
  notable Discord events.
- `services/cr-api-bridge` — the TypeScript queue worker running on this fixed,
  Clash Royale API-allowlisted host. It relays player snapshots and the live
  Clan Wars season clock.
- `packages/contracts` and `packages/game-data` — shared TypeScript API contracts
  and the canonical Clash Royale card snapshot.
- `infra` — CloudFormation plus AWS SDK bootstrap/deployment automation.

Every player signs in with an email magic link. Online games start from a signed
server challenge; when the browser is offline, all six modes deal locally and
say plainly that the run will not be saved. Local runs are never queued or
promoted after reconnecting. Local display, input preferences, and adaptive
card-learning hints stay in **localStorage**; game history, player profiles,
per-player Player XP, and leaderboards live in DynamoDB. Player XP is an activity score
(one point per question practiced, right or wrong) that drives a per-player
arena; the leaderboard is ranked purely on speed. Practice is the one mode
outside both systems: it earns no XP and keeps no record. A separate global games
counter began at a one-time launch seed of 592 and advances once for every
server-accepted completed game — shown on Home as social proof; page views and
Tinylytics analytics never contribute to it.
Each signed-in player chooses a favorite Clash Royale card as their profile
image and selects a safe, playful name inspired by that card, including its
community nicknames and character.

---

## Local development

```bash
npm install
npm run dev       # Vite dev server
npm run verify:quick # routine web pre-push gate
npm run verify    # exhaustive four-browser gate for high-risk changes
npm run build     # build every implemented workspace
npm run preview   # serve the build locally
npm run build:admin # build the private Control Room and its local service
npm run check:beta # full quality gate plus production API smoke
```

The root commands use npm workspaces. The repo ships with a committed
`packages/game-data/cards.json` snapshot and mirrored card art, so the **UI**
runs locally with no API key or secrets — you can browse and reach every game's
ready screen without signing in. There is no local API stack yet:
`apps/web/public/api-config.json` points the dev server at the **deployed
production API**, so signing in and recording games hit the live backend. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full local-development story, the
quality gate, and repo conventions.

Elixir Drop intentionally does **not** maintain curated deck definitions,
archetype data, or "real deck" dependencies — new modes work from the committed
card facts in `cards.json`. [`GAMES.md`](GAMES.md) explains why.

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

A push to `main` first runs cancelable, cumulative validation in
`.github/workflows/validate-main.yml`. A successful exact head enters the
serialized `.github/workflows/deploy.yml`: API-only work deploys and smokes only
the Lambda, while web/shared work updates the API's referee version, smokes it,
rebuilds against the stack endpoint, and then publishes Pages. Test-only and
fixed-host changes do not republish unrelated public surfaces. The exhaustive
four-browser matrix runs on pull requests, manually, and daily in `verify.yml`.

The website is GitHub Pages on the custom domain `drop.poapkings.com`:

- `apps/web/public/CNAME` contains the domain; Vite `base` is `/` (custom domain
  serves from root).
- "Enforce HTTPS" is on once the certificate provisions.

The same deployment commands run locally for first-time setup, secret rotation, or
recovering a deploy CI could not finish:

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
├─ .github/workflows/        # main validation/deploy + exhaustive PR/daily verification
├─ AGENT-TEAM/               # scheduled and on-demand maintainer role prompts
├─ AGENTS.md                 # agent entry point + the canonical doc map
├─ CLAUDE.md                 # agent working guide: golden rules and architecture
├─ CONTRIBUTING.md           # local dev, the quality gate, conventions
├─ SPEC.md                   # current implementation spec and constraints
├─ GAMES.md                  # canonical games catalog + idea backlog
└─ docs/card-rendering.md    # shared card rendering reference
```

The Clash Royale API reference under `docs/cr-agent-api-docs/` is source material
for the static card refresher and bridge normalization; it is not an API design.
The Clash Royale screenshots under `docs/clash-royale-screenshots/` are visual
reference for the shared card chrome, not runtime assets.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup,
the quality gate, and conventions.

## License

The **source code** is [MIT licensed](./LICENSE). Clash Royale card art and data
distributed in this repository are **not** covered by that license — they are ©
Supercell under the Fan Content Policy (see below) and are not ours to
relicense.

## Credits & fan content

Run by [POAP KINGS](https://poapkings.com) (clan tag `#J2RGCRVG`).

This is an unofficial fan project. Clash Royale card data, names, and artwork are
© Supercell, used under
[Supercell's Fan Content Policy](https://www.supercell.com/fan-content-policy).
Not endorsed by Supercell. Non-commercial.
