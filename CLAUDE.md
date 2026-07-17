# CLAUDE.md - Elixir Drop

A static, single-page game for learning **Clash Royale elixir costs**, run by the
POAP KINGS clan. Preact + Signals + Vite, deployed to GitHub Pages at
`drop.poapkings.com`.

Doc map:

- **`README.md`** is the public overview and local-development entry point.
- **`SPEC.md`** is the current implementation spec and product constraints.
- **`GAMES.md`** is the canonical games catalog: shipped modes, retired modes,
  and backlog ideas.
- **`docs/card-rendering.md`** is the Clash-style card rendering reference and
  helper guide.
- **`CLAUDE.md`** is the agent working guide.

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
- `npm run dev` · `npm run build` (to `dist/`) · `npm run preview`.
- Before pushing code, run `npm run verify`. It mirrors the GitHub Pages deploy
  gates: format, lint, CSS lint, typecheck, Knip, unit tests, Chromium e2e, and
  production build.
- `node scripts/refresh-cards.mjs` — card refresh; **runs only on the managed
  host**, not here. For local dev, work against the committed `cards.json` seed.

---

## Architecture

- **`src/lib/storage.ts` is the hard persistence boundary.** All progress
  reads/writes go through it (`getProfile`, `getRecords`, `getCardStats`,
  `saveResult`, …). v2 swaps the localStorage body for `fetch` without touching
  game logic. Keep it isolated.
- **localStorage keys** use the `elixirdrop:` prefix: `profile`, `cardStats`,
  `records`, `funnel`, `settings`.
- **`src/lib/sampling.ts`** — weighted SRS-lite: surface missed cards more, fade
  mastered ones, avoid immediate repeats. Tunables in one config object.
- **`src/lib/choices.ts`** — `makeChoices(elixir)` returns **adjacent** costs only
  (a 4-cost → {3,4,5,6}), never random. Shared by all multiple-choice surfaces.
- **`src/lib/name-choices.ts`** — `makeNameChoices(card, cards)` returns the
  target plus similar card-name distractors for identification modes.
- **`src/lib/card-rendering.ts`** — shared rarity labels, modifier classes, and
  Clash-style card-name tone mapping. Pair it with `src/components/CardChrome.tsx`
  instead of hand-rolling card art/name/cost UI in a mode.
- **`src/lib/elixir-lines.ts`** — the host's static line table, keyed by event
  (`correct_fast`, `wrong_close`, `surge_done`, `record`, `recruit`, …). No LLM at
  runtime. Elixir stays **silent during Surge** (timing) and speaks on summaries.
- **`src/lib/run-loop.ts`** — shared countdown, timeout clearing, and elapsed-time
  helpers for timed modes.
- **`src/lib/endless-ladder.ts`** — pure Endless Ladder insertion-slot logic.
- **`src/lib/cost-sweep.ts`** — pure Cost Sweep target tracking.
- **`src/lib/insights.ts`** — Practice and Surge coaching insights.
- **`src/lib/mode-insights.ts`** — mode-specific summary lines for Identify,
  Trade, and Speed Ladder.
- **Modes** in `src/modes/`: `surge`, `practice`, `identify`, `higher-lower`,
  `trade`, `blitz`, `survival`, `ladder`, `endless-ladder`, `cost-sweep`. See
  `GAMES.md` for each game's mechanic, scoring, route, and records key, plus the
  idea backlog and retired modes.
- **No curated deck definitions.** Do not add `decks.json`, archetype lists, or
  games that require authentic deck coherence. New modes should work from the
  committed `cards.json` facts only.
- **Surge timing** uses `performance.now()` (monotonic), not `Date.now()`.
  Preload the sprint's card images before the clock starts.

---

## Card data shape (`src/data/cards.json`)

```json
{
  "version": "YYYY-MM-DD",
  "count": 120,
  "cards": [
    {
      "id": 26000000,
      "name": "Knight",
      "elixir": 3,
      "rarity": "common",
      "type": "troop",
      "evo": false,
      "hero": false,
      "icon": "https://api-assets.clashroyale.com/cards/300/....png"
    }
  ]
}
```

The committed snapshot is authoritative for the running app. From `/cards`, use
the `items` array (standard cards with `elixirCost`);
**exclude `supportItems`** (4 Tower Troops — no cost). `type` from id range
(26→troop, 27→building, 28→spell). `evo`/`hero` from `maxEvolutionLevel`
(1→evo, 2→hero, 3→both). `icon` = `iconUrls.medium` (CDN), or local path if
`MIRROR_IMAGES=true`.

---

## Current product decisions

- **Surge scoring:** golf time (elapsed + penalties; lower wins). Sprint of 15;
  +2.0s per wrong answer; the card stays until correct.
- **Practice input:** offer both 4-button multiple choice and the 1–10 pip keypad;
  remember the choice in settings. Default to the keypad.
- **Evolutions:** quiz on **base elixir only**; show Evo/Hero as flavor, not as
  part of the answer.
- **Elixir voice:** dry, a little cocky, never mean. Short lines.
- **Daily Ladder:** deferred. Do not build it unless the user explicitly
  re-approves that mode.

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

## Working workflow

Before changing a game, read `GAMES.md` and keep it updated with any product
decision. Before changing shared architecture, read `SPEC.md` and keep that
current too.

For UI/gameplay changes:

- Preserve the active-play `game-run` behavior for timed modes: compact header,
  hidden footer/star counter, visible controls, no horizontal overflow.
- Honor `prefers-reduced-motion` and the in-app reduced-motion setting for
  celebratory effects.
- Add or update focused unit/e2e coverage when changing shared logic, scoring,
  storage, or mobile gameplay controls.
- Run `npm run verify` before pushing.

When a decision is genuinely ambiguous and not covered above, in `SPEC.md`, or in
`GAMES.md`, stop and ask rather than guessing.
