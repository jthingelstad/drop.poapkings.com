# Elixir Drop

A fast little game for learning **Clash Royale elixir costs**, run by the
**POAP KINGS** clan. See a card, name its cost, get quicker. Built as a
self-contained static single-page app.

**Play:** [drop.poapkings.com](https://drop.poapkings.com)

---

## What it is

Several ways to play, one engine. The four core modes:

- **Practice** — untimed. A card appears, you pick its elixir cost. No pressure;
  good for learning the loop and grinding your weak cards.
- **Surge** — the flagship speed game. A 15-card sprint against the clock; wrong
  answers add a time penalty. Your score is your time — lower is better. One
  clean, shareable number.
- **Higher / Lower** — two cards, pick which costs more. Trains the relative
  read that actually wins elixir trades.
- **Trade** — you are Blue King; Red answers your cards. Guess whether you won
  or lost the elixir trade.

Plus stretch modes — **Blitz**, **Survival**, and **Speed Ladder**. See
[`GAMES.md`](GAMES.md) for the full catalog, retired modes, and backlog of game
ideas.

A weighted sampler surfaces the cards you miss more often, and a short
end-of-session insight ("you bleed time on 5–6 cost cards") turns the game into
a coach rather than a quiz. **Elixir**, the clan's mascot, hosts.

It's also a quiet front door to the clan: a good run is met with an invite, not
a banner.

---

## Tech

- **Preact** + **@preact/signals**, built with **Vite** (TypeScript)
- Hash-based routing — no server, no SPA 404s on static hosting
- **localStorage** for all personalization (records, weak-card stats), behind a
  single swappable `storage` module
- **Tinylytics** for lightweight, privacy-friendly analytics
- **GitHub Pages** hosting, deployed by GitHub Actions on push

No backend, no accounts, no tracking beyond Tinylytics.

---

## Local development

```bash
npm install
npm run dev      # Vite dev server
npm run build    # static build to dist/
npm run preview  # serve the build locally
```

The repo ships with a committed `src/data/cards.json` snapshot, so the game runs
fully offline in dev — no API key required to develop.

Elixir Drop intentionally does **not** maintain curated deck definitions or
archetype data. New modes should work from the committed card facts in
`cards.json` instead of requiring a separate `decks.json` dataset.

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
- The token sits in `.env` there (`CR_API_TOKEN`) — **gitignored**, never committed.
- A cron job (or manual run) executes `scripts/refresh-cards.mjs`, which fetches
  `/cards`, normalizes it, **diffs** against the committed snapshot, and **commits
  only when something changed** (printing a changelog of new/changed/removed cards).
- That push triggers the GitHub Actions build + deploy. The Pages build only ever
  reads the committed `cards.json` — so the token stays off CI entirely.

Card art is hotlinked from Supercell's CDN (`api-assets.clashroyale.com`) and
preloaded before timed runs. A `MIRROR_IMAGES` flag in the refresh script can
download art locally instead, with no game-code change.

---

## Deploy

GitHub Pages, custom domain `drop.poapkings.com`:

- `public/CNAME` contains the domain; Vite `base` is `/` (custom domain serves
  from root).
- `.github/workflows/deploy.yml` builds and deploys on push to `main`.
- "Enforce HTTPS" is on once the certificate provisions.

---

## Project structure

```
elixir-drop/
├─ public/
│  ├─ CNAME                  # drop.poapkings.com
│  └─ assets/                # Elixir avatar, favicon, OG image
├─ src/
│  ├─ data/cards.json        # committed snapshot (refreshed out-of-band)
│  ├─ lib/                   # storage seam, sampler, distractors, line table
│  ├─ modes/                 # practice, surge, higher-lower, trade, blitz, survival, ladder
│  ├─ components/            # Card, PipKeypad, ElixirHost, StarCount, …
│  ├─ styles.css             # vendored POAP KINGS tokens + components
│  └─ main.tsx
├─ scripts/refresh-cards.mjs # manual/cron card refresh (runs on the managed host)
├─ .github/workflows/deploy.yml
├─ .env.example              # CR_API_TOKEN, MIRROR_IMAGES
├─ SPEC.md                   # full specification
├─ GAMES.md                  # games catalog + idea backlog
└─ CLAUDE.md                 # build guide for Claude Code
```

---

## Credits & fan content

Run by [POAP KINGS](https://poapkings.com) (clan tag `#J2RGCRVG`).

This is an unofficial fan project. Clash Royale card data, names, and artwork are
© Supercell, used under
[Supercell's Fan Content Policy](https://www.supercell.com/fan-content-policy).
Not endorsed by Supercell. Non-commercial.
