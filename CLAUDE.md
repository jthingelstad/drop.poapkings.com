# CLAUDE.md — Elixir Drop

A static, single-page game for learning **Clash Royale elixir costs**, run by the
POAP KINGS clan. Preact + Signals + Vite, deployed to GitHub Pages at
`drop.poapkings.com`.

**`SPEC.md` is the full specification — read it before building.** This file is
the rules and the map; `SPEC.md` is the detail. **`GAMES.md` is the games
catalog** — the shipped modes and the backlog of game ideas; read it before
adding or reworking a game.

---

## Golden rules (do not violate)

1. **Standalone.** Elixir Drop has **no shared dataset, analytics property, or
   runtime dependency** with the `poapkings.com` site or the Elixir Discord bot
   (its Discord/SQLite stores). Do **not** import from, fetch from, or couple to
   them. The only outbound ties are plain hyperlinks (clan invite, Discord) in the
   recruit funnel.
2. **Never call the Clash Royale API at runtime or in CI.** The browser can't
   (CORS) and CI can't (IP-allowlisted token). Card data comes only from the
   committed `src/data/cards.json` snapshot.
3. **The CR token lives only in `.env` on a managed host.** It is gitignored.
   Never commit it, never read it in client or CI code, never put it in the
   deploy workflow. Only `scripts/refresh-cards.mjs` reads it.
4. **GitHub Pages + hash routing.** Custom domain via `public/CNAME`; Vite
   `base: '/'`; hash routing only (no history API — it 404s on Pages). The deploy
   build reads the committed JSON; it needs no secrets.
5. **Vendor the look; don't link it.** Copy POAP KINGS design tokens, fonts, and
   reused component CSS into this repo's own `styles.css`/assets. Bundle a copy of
   the Elixir avatar in `public/assets`. No runtime link to the clan site.
6. **Fan-content & copyright.** Card art is used under Supercell's Fan Content
   Policy: non-commercial, attributed, keep the footer disclaimer. Don't reproduce
   other copyrighted text.

---

## Stack & commands

- **Preact** + **@preact/signals**, **Vite**, **TypeScript**.
- `npm run dev` · `npm run build` (→ `dist/`) · `npm run preview`.
- `node scripts/refresh-cards.mjs` — card refresh; **runs only on the managed
  host**, not here. For local dev, work against the committed `cards.json` seed.

---

## Architecture

- **`src/lib/storage.ts` is a hard seam.** All progress reads/writes go through it
  (`getProfile`, `getRecords`, `getCardStats`, `saveResult`, …). v2 swaps the
  localStorage body for `fetch` without touching game logic. Keep it isolated.
- **localStorage keys** use the `elixirdrop:` prefix: `profile`, `cardStats`,
  `records`, `funnel`, `settings`.
- **`src/lib/sampling.ts`** — weighted SRS-lite: surface missed cards more, fade
  mastered ones, avoid immediate repeats. Tunables in one config object.
- **`src/lib/choices.ts`** — `makeChoices(elixir)` returns **adjacent** costs only
  (a 4-cost → {3,4,5,6}), never random. Shared by all multiple-choice surfaces.
- **`src/lib/elixir-lines.ts`** — the host's static line table, keyed by event
  (`correct_fast`, `wrong_close`, `surge_done`, `record`, `recruit`, …). No LLM at
  runtime. Elixir stays **silent during Surge** (timing) and speaks on summaries.
- **Modes** in `src/modes/`: core `practice`, `surge`, `higher-lower`; stretch
  `blitz`, `survival`, `focus`, `deck-budget`. See `GAMES.md` for each game's
  mechanic, scoring, route, and records key, plus the idea backlog.
- **Surge timing** uses `performance.now()` (monotonic), not `Date.now()`.
  Preload the sprint's card images before the clock starts.

---

## Card data shape (`src/data/cards.json`)

```json
{ "version": "YYYY-MM-DD", "count": 121, "cards": [
  { "id": 26000000, "name": "Knight", "elixir": 3, "rarity": "common",
    "type": "troop", "evo": false, "hero": false,
    "icon": "https://api-assets.clashroyale.com/cards/300/....png" }
]}
```

From `/cards`: use the `items` array (121 standard cards, each has `elixirCost`);
**exclude `supportItems`** (4 Tower Troops — no cost). `type` from id range
(26→troop, 27→building, 28→spell). `evo`/`hero` from `maxEvolutionLevel`
(1→evo, 2→hero, 3→both). `icon` = `iconUrls.medium` (CDN), or local path if
`MIRROR_IMAGES=true`.

---

## Working defaults (open decisions — use these unless told otherwise)

- **Surge scoring:** golf time (elapsed + penalties; lower wins). Sprint of 15;
  +2.0s per wrong answer; the card stays until correct. Blitz variant is optional.
- **Practice input:** offer both 4-button multiple choice and the 1–10 pip keypad;
  remember the choice in settings. Default to the keypad.
- **Evolutions:** quiz on **base elixir only**; show Evo/Hero as flavor, not as
  part of the answer.
- **Elixir voice:** dry, a little cocky, never mean. Short lines.

---

## Key values

- Tinylytics site ID: `JjqvUeyEnrPM1f_iXrbU` (integer `3445`). Embed in `<head>`:
  `https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU.js?spa&hits&kudos=%F0%9F%91%8F&countries&events&beacon`
- Clan invite: `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
- Discord: `https://discord.gg/kBD62fYHWx` — the clan is often full; lead with
  Discord when it is (mirror the site's JOIN/WAIT pattern).
- Recruit is **moments, not chrome**: trigger on a new PB / strong session, never
  a load-time modal. Keep a quiet "Run by POAP KINGS" footer link always.

---

## Build order

Follow `SPEC.md` §10. In short: scaffold + Pages plumbing → `refresh-cards.mjs` +
seed data → **Practice loop (make it fun first)** → storage + sampling → pip keypad
→ **Surge** → Elixir host → summary + insights → Higher/Lower → Tinylytics →
recruit funnel → polish (sound + reduced-motion toggles, responsive). Honor
`prefers-reduced-motion` on all celebratory FX.

When a decision is genuinely ambiguous and not covered above or in `SPEC.md`,
stop and ask rather than guessing.
