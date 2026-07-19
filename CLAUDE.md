# CLAUDE.md - Elixir Drop Monorepo

Elixir Drop is a game for learning **Clash Royale elixir costs**, run by the POAP
KINGS clan. The public Preact application is deployed to GitHub Pages at
`drop.poapkings.com`; this monorepo includes a Lambda player API and reserves a
boundary for a fixed-IP Clash Royale API bridge.

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

1. **Keep workspace boundaries explicit.** `apps/web` owns the browser product,
   `services/api` owns the TypeScript Lambda backend, `services/cr-api-bridge` owns
   fixed-IP Clash Royale access, and `infra` owns cloud definitions. Do
   not import service implementation files directly across those boundaries.
2. **Only the bridge may call the Clash Royale API at runtime.** The browser and
   Lambda backend must never call it directly. The current website reads the
   committed `packages/game-data/cards.json` snapshot; future dynamic backend
   requests go through the asynchronous SQS bridge boundary.
3. **The CR token lives only on the managed, allowlisted host.** It is
   gitignored. Never commit it, expose it to the browser, place it in CI, or put
   it in Lambda configuration. The static refresher and local bridge are the
   only implemented consumers on the allowlisted host.
   The bridge owns both queued player enrichment and the periodic Clan Wars
   clock relay; Lambda consumes normalized results only.
4. **The public website remains GitHub Pages + hash routing.** Its custom domain
   is in `apps/web/public/CNAME`; Vite uses `base: '/'`; history routing will 404
   on Pages. The deploy build needs no secrets.
5. **Vendor the look; don't link it.** Copy POAP KINGS design tokens, fonts, and
   reused component CSS into `apps/web/src/styles.css` and its assets. Bundle a
   copy of the Elixir avatar in `apps/web/public/assets`. No runtime asset link to
   the clan site.
6. **Fan-content & copyright.** Card art is used under Supercell's Fan Content
   Policy: non-commercial, attributed, keep the footer disclaimer. Don't reproduce
   other copyrighted text.

---

## Stack & commands

- npm workspaces at the repository root; Node 24 is authoritative.
- `apps/web`: **Preact** + **@preact/signals**, **Vite**, **TypeScript**.
- `npm run dev` · `npm run build` · `npm run preview` run from the repo root.
- Before pushing code, run root `npm run verify`. It runs each implemented
  workspace's verification script; today the web gates are format, lint, CSS
  lint, typecheck, Knip, unit tests, Chromium e2e, and production build.
- `node apps/web/scripts/refresh-cards.mjs` — static card refresh; **runs only on
  the managed host**. For local development, use the committed snapshot.

The player API, infrastructure, and bridge are implemented and documented in
their workspace READMEs. Keep the request/result contracts in
`packages/contracts`; do not bypass the queues or widen the CR snapshot with
rank-oriented fields as part of unrelated work.

---

## Architecture

- **`apps/web/src/lib/storage.ts` is the local learning-data boundary.**
  All progress reads/writes go through it (`getProfile`, `getRecords`,
  `getCardStats`, `saveResult`, …). Authenticated identity and signed runs use
  `apps/web/src/lib/account.ts`, `api.ts`, and `use-game-run.ts`.
- **localStorage keys** use the `elixirdrop:` prefix: `profile`, `cardStats`,
  `records`, `seasonRecords`, `funnel`, `settings`.
- **Authenticated identity is card-bound.** `favoriteCardId` must resolve in the
  canonical card snapshot. Claude Haiku may use community nicknames and playful
  card associations; the public name does not need the exact card title.
  Name-option tokens bind the player, card ID, and exact safe choices; the API
  saves favorite card and public name together. Keep player tags separate and
  explicitly unverified.
- **Every new run uses the full canonical catalog and ranks.** Linked Clash
  Royale collection data remains on the player profile for future features but
  never changes challenge selection. The optional `ranked` field remains only
  so historical unranked runs can be read safely.
- **Learning stats are server-owned** (`services/api/src/learning.ts`): derived
  from validated transcripts at completion, stored per player, and returned in
  the GET /me learning summary for possible future coaching. They do not affect
  challenge selection. The browser uploads nothing; localStorage stats are a
  display cache.
- **Glyphs come from lucide-static** through `apps/web/src/components/Icon.tsx`
  (build-time inlined, currentColor). Don't hand-type arrows or symbols.
- **"Elixir Rain" screensaver egg**: activation state in
  `apps/web/src/lib/screensaver.ts` (5 logo taps or 2-min Home idle; full
  no-op under reduced motion), overlay in `components/Screensaver.tsx`, Pixi
  scene in `components/ScreensaverScene.ts` (lazy chunk via
  `lib/load-pixi.ts`). It must never trigger on gameplay routes.
- **Card selection is server-owned.** Signed challenges from
  `services/api/src/scoring.ts` deal every game (no immediate repeats across
  shuffle boundaries); `apps/web/src/lib/game-challenge-content.ts` resolves
  them into playable content. The old client-side `sampling.ts` is gone.
- **`apps/web/src/lib/choices.ts`** — `makeChoices(elixir)` returns **adjacent** costs only
  (a 4-cost → {3,4,5,6}), never random. Shared by all multiple-choice surfaces.
- **`apps/web/src/lib/name-choices.ts`** — `makeNameChoices(card, cards)` returns the
  target plus similar card-name distractors for identification modes.
- **`apps/web/src/lib/card-rendering.ts`** — shared rarity labels, modifier classes, and
  Clash-style card-name tone mapping. Pair it with `apps/web/src/components/CardChrome.tsx`
  instead of hand-rolling card art/name/cost UI in a mode.
- **Player avatars are CSS crops, not derivative assets.** Shared defaults and
  exceptional per-card focal adjustments live in
  `apps/web/src/data/avatar-crops.ts`. Review the complete catalog at the
  development-only `#/avatar-audit` route before adding an override.
- **`apps/web/src/lib/elixir-lines.ts`** — the host's static line table, keyed by event
  (`correct_fast`, `wrong_close`, `surge_done`, `record`, `recruit`, …). No LLM at
  runtime. Elixir stays **silent during Surge** (timing) and speaks on summaries.
- **`apps/web/src/lib/run-loop.ts`** — shared countdown, timeout clearing, and elapsed-time
  helpers for timed modes.
- **`apps/web/src/lib/endless-ladder.ts`** — pure Endless Ladder insertion-slot logic.
- **`apps/web/src/lib/cost-sweep.ts`** — pure Cost Sweep target tracking.
- **`apps/web/src/lib/insights.ts`** — Practice and Surge coaching insights.
- **`apps/web/src/lib/mode-insights.ts`** — mode-specific summary lines for Identify,
  Trade, and Speed Ladder.
- **Modes** in `apps/web/src/modes/`: `surge`, `practice`, `identify`, `higher-lower`,
  `trade`, `blitz`, `survival`, `ladder`, `endless-ladder`, `cost-sweep`. See
  `GAMES.md` for each game's mechanic, scoring, route, and records key, plus the
  idea backlog and retired modes.
- **No curated deck definitions.** Do not add `decks.json`, archetype lists, or
  games that require authentic deck coherence. New modes should work from the
  committed `cards.json` facts only.
- **CR profile snapshots are practice context, not rank context.** Store CR name,
  clan, Years Played account age, and cards. Do not add experience, arenas,
  trophies, wins, or card levels. Player tags remain unverified ownership.
- **The site-wide Trophy Road advances on completed games, never traffic.**
  `GET /stats.trophyRoadGames` has the stable one-time launch seed of 592, then
  increments atomically with every server-accepted run. Keep the real tracked
  total separate. Tinylytics is analytics only; seasonal leaderboard resets do
  not reset Trophy Road.
- **Surge timing** uses `performance.now()` (monotonic), not `Date.now()`.
  Preload the sprint's card images before the clock starts.

---

## Card data shape (`packages/game-data/cards.json`)

```json
{
  "version": "YYYY-MM-DD",
  "count": 121,
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
(1→evo, 2→hero, 3→both). `icon` = local `/cards/{id}.png` (art is mirrored —
refresh always sets `MIRROR_IMAGES=true`; CDN URLs would break WebGL textures under CSP), historically `iconUrls.medium` if
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
- Discord: `https://discord.gg/SdvKfJW5kA` — the clan is often full; lead with
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
