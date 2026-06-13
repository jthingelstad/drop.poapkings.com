# Elixir Drop — Build-Out Phase 2 (BUILD2.md)

Phase 1 (`BUILD.md`) is complete: all three v1 modes, the learning engine, the
host, summaries, recruit funnel, analytics, polish/a11y scaffolding, and all four
v1.5 **stretch modes** are built, pass CI, and are deployed to `main`
(GitHub Pages → `drop.poapkings.com`).

Phase 1 ran in **Claude Code on the web** (a cloud sandbox), which couldn't open a
real browser or reach the live domain / CDNs. So everything here is either (a) work
that genuinely needs a **local environment with a browser and the real assets**, or
(b) follow-ups intentionally deferred to keep Phase 1 focused. Do the design pass
and **browser testing** first — they're the reason we stopped — then the rest.

> Same rules as `BUILD.md`: keep `SPEC.md` and `CLAUDE.md` authoritative. Don't
> couple to `poapkings.com` or the Elixir bot. Never call the CR API at runtime/CI.
> All progress goes through `src/lib/storage.ts`. Hash routing only.

---

## Reference material (read-only — vendor the look, mirror the voice; never couple)

Two sibling repos are the canonical sources for the look and the persona. Per
CLAUDE.md golden rule #1, Elixir Drop stays **standalone**: copy tokens/CSS/art and
mirror the persona's phrasing, but add **no** shared dataset, analytics property, or
runtime/build dependency on either. The only outbound ties remain plain hyperlinks
(clan invite, Discord).

- **`jthingelstad/poapkings.com`** — https://github.com/jthingelstad/poapkings.com
  (the clan website, Nunjucks/Eleventy). **Design source of truth.** Pull the design
  tokens, the `body` background gradient, the reused component CSS (`.btn*`, `.pill*`,
  `.pcard`, `.pl-elixir__drop`, `.starcount`, `.site-foot`, eyebrows/headings), and
  the `Clash`/`Supercell Magic`/`Inter` font files from its `src/styles.css` + assets.
  This is what `src/styles.css` here was vendored from; use it as the reference when
  doing the design pass and dropping in real fonts. Also mirror its `supercellDisclaimer`
  wording and JOIN/WAIT recruit pattern.
- **`jthingelstad/elixir-bot`** — https://github.com/jthingelstad/elixir-bot
  (the Clash Royale Discord bot, Python). **Persona source of truth for "Elixir."**
  Mirror the bot's voice — dry, a little cocky, never mean — and any canonical
  catchphrases/line phrasing into `src/lib/elixir-lines.ts` (static table only; no LLM
  at runtime, no connection to the bot's Discord/SQLite stores). Use it to keep the
  host consistent with how Elixir already talks in the clan.

When the live `poapkings.com` site blocks automated fetches, read the **repo** for
the exact tokens/CSS/copy rather than scraping the rendered page.

---

## Where things stand (snapshot for whoever picks this up)

**Modes** (`src/modes/`): `practice` (rounds of 15 + end-early + summary),
`surge` (15-card sprint, golf time, PB, share, recruit), `higher-lower`
(streak + `longestStreak`), plus stretch: `blitz` (60s count-up), `survival`
(sudden death, per-card 5s clock), `focus` (subset selector → shared
`PracticeLoop`), `deck-budget` (pick 8 to a target average).

**Shared libs** (`src/lib/`): `storage` (seam; keys `elixirdrop:profile|cardStats|
records|funnel|settings`), `sampling` (SRS-lite), `choices` (adjacent distractors),
`insights` (bands / weakest / bias / slowest), `elixir-lines` (static line table),
`analytics` (Tinylytics `category.action` events + funnel mirror), `preload`,
`sound` (Web Audio, off by default), `motion` (reduced-motion override), `router`
(hash), `format`.

**Components** (`src/components/`): `CardDisplay` (revealCost/forceReveal/text-chip
fallback), `PipKeypad`, `MultipleChoice`, `ElixirHost` (avatar slot), `Summary`
(kudos slot), `ShareLine`, `StarCount` (Drop Stars), `Recruit`.

**Records keys** (`Records` in `src/types.ts`): `surgeBest`, `longestStreak`,
`bestAccuracy`, `blitzBest`, `survivalBest`, `deckBudgetBest`.

**CI gates** (all green): `format:check`, `lint`, `lint:css`, `typecheck`, `knip`,
`build`. Deploy workflow triggers only on `src/** public/** index.html vite.config.ts
tsconfig.json package-lock.json .github/workflows/deploy.yml` — so docs like this
file do **not** trigger a deploy.

**Known constraints carried over from the cloud build** (each becomes a task below):
- No real browser → no visual/interaction/screenshot QA was possible (Phase-1
  verification was logic tests + jsdom SSR render-smoke only).
- Tinylytics event registration, hits→stars, and kudos are **unverified on the live
  property** (sandbox egress blocked `tinylytics.app`).
- Card art shows the **text-chip fallback** in the sandbox (CR CDN unreachable); it
  should load real art on the live site — verify.
- Fonts, the Elixir avatar, the OG image, and the favicon are **placeholders/slots**.
- The logic + render-smoke tests were run **transiently** (not committed) — see
  Appendix B to make them permanent.
- `Recruit` has a hardcoded `CLAN_FULL = true` (leads with Discord). Flip when open.
- Records are stored but there is **no stats/profile screen** to view them yet.

---

## Phase 2 groups & sequencing

Groups are ordered. Within a group, do the bullets top-to-bottom. Each group ends
with a **Checkpoint** — verify it before moving on.

### Group 0 — Local bring-up (do first)
```
- Clone, `npm install`, `npm run dev`; open in a real browser.
- Run the full gate set once locally: format:check, lint, lint:css, typecheck,
  knip, build. Confirm green (matches CI).
- Click every route from a cold load (hash URLs): /, /practice, /surge,
  /higher-lower, /blitz, /survival, /focus, /deck-budget, /settings. No 404s,
  no console errors.
Checkpoint: app runs locally, all gates green, every screen reachable.
```

### Group 1 — Real assets (unblocks the design truth)
Source fonts/tokens/art from **`jthingelstad/poapkings.com`** (see Reference material).
```
- Fonts: copy Clash Display (.otf) + Supercell Magic (.otf) from the poapkings.com
  repo into public/assets/fonts/ at the exact paths in src/styles.css @font-face
  rules. Confirm display headings render in Clash, not the system fallback.
- Elixir avatar: replace public/assets/elixir-avatar.svg with real art. For
  expressions, add per-mood files and map them in components/ElixirHost.tsx
  (AVATARS = { neutral, hype, unimpressed }). Verify the three moods read
  distinctly (Practice correct/wrong, summary).
- OG/share image: replace public/assets/og-image.svg with a final 1200×630 PNG;
  update the og:image / twitter:image paths in index.html if the filename changes.
- Favicon: swap the SVG favicon for final art (favicon.svg/.ico + apple-touch-icon).
Checkpoint: fonts, avatar, OG, and favicon are real; no placeholder art remains.
```

### Group 2 — Design pass (the headline of Phase 2)
Match the POAP KINGS look. **SPEC §8 is the vendored contract and tokens already
match exactly**; use the **`poapkings.com` repo** (and the live site for feel) as the
side-by-side reference the cloud build could not make.
```
- Core modes first: Home, Practice, Surge, Higher/Lower — spacing, type scale,
  card framing (.pcard), pip keypad ergonomics, the .pl-elixir__drop motif and
  its celebration, Surge HUD/countdown. Diff component CSS against the clan repo.
- Then summaries: shared Summary (band bars, weakest/slowest chips, kudos),
  ShareLine, Recruit callout. Make the "earned moment" feel earned.
- Then stretch modes — these were built functional, not design-passed. Biggest
  net-new UI is Deck Budget's selectable grid (cell density, selected state,
  the target-vs-average HUD). Blitz/Survival reuse the Surge HUD; Focus reuses
  the home mode-cards — sanity-check those reuses look intentional.
- Voice: with elixir-bot open, refine src/lib/elixir-lines.ts so Elixir sounds
  like the clan's bot (dry, cocky, never mean); seed any canonical catchphrases.
- Motion/feel: drop pop, streak, star pop, countdown, transitions. Tune timings.
Checkpoint: every screen feels on-brand vs poapkings.com; Elixir's voice matches
the bot; no unstyled/awkward areas.
```

### Group 3 — Extensive browser testing (the other reason we stopped)
Phase 1 could not run a browser (the sandbox blocked Playwright's download). Do this
for real now. Recommend **Playwright** (`npm i -D @playwright/test` then
`npx playwright install`). Make randomness deterministic for stable flows by stubbing
`Math.random` and (where needed) `performance.now` via `page.addInitScript` so the
sampler, Surge timing, and Deck Budget targets are reproducible.

```
Cross-cutting rules for every test:
- Fail the test on ANY console.error or pageerror (attach listeners; assert none).
- Run the matrix on Chromium, WebKit, and Firefox; plus mobile emulation
  (e.g. Pixel 7 and iPhone 14 viewports) for thumb-target + layout checks.
- Capture a screenshot per screen and per key state (artifact for the design pass);
  optionally add visual-regression baselines (expect(page).toHaveScreenshot()).

Per-screen / per-flow matrix:
- Home: both mode sections render; each card navigates to the right hash route;
  Drop Stars + settings gear present; footer disclaimer + POAP KINGS link.
- Practice: a full round of 15 advances and ends in the summary; end-early works;
  input toggle (keypad ↔ 4 choices) persists across reload (settings); band bars,
  weakest chips, and Elixir's session_end line render.
- Surge: "Get ready" waits for preload (no image pop-in mid-run — assert images
  are loaded before the clock starts); timer is monotonic/honest; a wrong tap adds
  +2.0s and the card STAYS until correct; finishing shows "15 cards · Ns"; a new PB
  persists across a reload (localStorage elixirdrop:records.surgeBest); ShareLine
  copies; Recruit shows only on a PB.
- Higher/Lower: Higher/Equal/Lower grade correctly (including an Equal pair); streak
  increments and longestStreak persists across reload.
- Blitz: 60s window counts down; HUD goes red under 10s; miss keeps the card up;
  blitzBest persists; summary headline = "{n} cleared".
- Survival: a wrong tap ends the run; a TIMEOUT (let the per-card bar expire) also
  ends it; the missed card's cost is revealed; survivalBest persists.
- Focus: each subset (spells/buildings/troops, 1–2/3–4/5+, weak cards) restricts the
  pool; "weak cards" with no history falls back to the full catalog; Home returns to
  the subset picker.
- Deck Budget: selecting 8 enables "Score"; running average is correct; grade matches
  the diff; "New target" reshuffles; deckBudgetBest (closest) persists.
- Settings: sound toggle plays a blip and persists; reduce-motion toggle adds
  .reduce-motion and stops celebratory FX; input-style persists.

Environment & resilience:
- Card art: assert icons load from api-assets.clashroyale.com on a real network;
  then simulate a blocked/broken asset (page.route → abort) and assert the
  text-chip fallback renders — the game must never break on a missing image.
- Reduced motion: emulate prefers-reduced-motion: reduce AND toggle the in-app
  setting; confirm FX stop while Surge keeps its timer + red flash.
- Persistence: drive a PB in each scored mode, reload, and assert the record
  survives; clear localStorage and assert clean first-run defaults.

Accessibility (automated, in-browser):
- Integrate @axe-core/playwright; run axe on every screen and fail on serious/
  critical violations. Manually verify keyboard nav, focus order/rings, aria-live on
  the Elixir bubble, and the Settings switch roles.

Optional CI gate:
- Wire a headless Chromium smoke subset (home + one full Surge run + a11y scan)
  into deploy.yml before build, with traces/screenshots uploaded as artifacts.
Checkpoint: the full matrix is green on 3 engines + mobile, zero console errors,
no serious axe violations, screenshots captured for the design pass.
```

### Group 4 — Real-device + performance pass
```
- Test on a real phone (not just emulation): pip keypad and the Deck Budget grid
  must be genuinely thumb-friendly; the column stays calm/centered; safe-area insets
  on notched devices.
- Lighthouse (mobile + desktop): performance, best-practices, SEO, a11y. Check the
  card-art preload strategy and bundle size; confirm no layout shift on card swaps.
Checkpoint: smooth on a real device; Lighthouse scores acceptable.
```

### Group 5 — Live analytics & data verification (needs the real domain)
```
- Tinylytics: confirm hits land on property JjqvUeyEnrPM1f_iXrbU; the Drop Stars
  counter (.tinylytics_hits) fills and pops; kudos (.tinylytics_kudos) works on the
  summary; and the custom events fire — game.start, mode.{practice,surge,
  higherlower,blitz,survival,deckbudget,focus}, surge.complete, record.new,
  recruit.{shown,join,discord}, result.share. (analytics.ts dispatches a synthetic
  click on a hidden [data-tinylytics-event]; verify that path registers in the
  Events dashboard, and adjust if the embed needs ?spa or a different trigger.)
- Recruit: confirm the funnel links open and the JOIN/WAIT copy matches the clan
  site's pattern; flip CLAN_FULL in components/Recruit.tsx if the clan is open.
Checkpoint: analytics events visible in Tinylytics; recruit links + copy correct.
```

### Group 6 — Tests into CI (make the transient + browser suites permanent)
```
- Unit/logic + SSR smoke: add vitest + jsdom + preact-render-to-string as devDeps
  and port the Phase-1 transient tests (Appendix B): (1) choices/format/insights/
  elixir-lines; (2) storage + SRS sampler (localStorage mock); (3) SSR render-smoke
  across all 9 screens.
- Browser: commit the Playwright suite from Group 3.
- Add a `test` script + CI steps in deploy.yml before build; update knip
  (entry/project or ignore) so test files don't trip the unused-file check.
Checkpoint: `npm test` (+ Playwright) green locally and in CI.
```

### Group 7 — Data pipeline & go-live ops (managed host / repo settings)
```
- On the managed host (registered IP + .env token), run scripts/refresh-cards.mjs
  for real; confirm the committed cards.json is a genuine refresh (count ~121, no
  hardcoding against the seed) and the game reads it cleanly. Add the cron entry.
- GitHub Pages: confirm custom domain + Enforce HTTPS once the cert provisions;
  confirm hash routing from a fresh load has no 404s on the live domain.
- Note: the two earliest deploys in history failed (before Pages was configured);
  every deploy since is green. Nothing to fix — just confirm settings.
Checkpoint: live site serves over HTTPS, reads the real snapshot, cron in place.
```

### Group 8 — Enhancements (optional, prioritize as desired)
```
- Stats/Profile screen: surface the stored Records (surgeBest, blitzBest,
  survivalBest, longestStreak, bestAccuracy, deckBudgetBest) + per-band mastery
  from cardStats. Records exist; nothing displays them yet. High value, low risk.
- Web Share API on the ShareLine (native share sheet on mobile; keep copy fallback).
- More SFX (streak / PB / countdown) behind the existing sound toggle.
- Blitz as a Surge sub-toggle: SURGE config already carries a MODE flag; Blitz is
  currently a separate route — unify only if it reads better.
- Higher/Lower end screen: it's an endless streak with no summary; consider a
  session summary/insights if desired.
- Deck Budget niceties: search/filter the grid; a shareable line for a Perfect build.
Checkpoint: each enhancement is opt-in and ships behind its own small change.
```

### Group 9 — v2 horizon (spec only; do not start without a decision)
```
- API + login + a real cross-player Surge leaderboard. The storage.ts seam is the
  designed insertion point: swap each function body for fetch() without touching
  game logic. Keep the elixirdrop: localStorage path as the offline fallback.
```

---

## Appendix A — Small follow-ups / tech debt
- `src/modes/deck-budget/DeckBudget.tsx` has two separate `preact/hooks` imports
  (`useEffect`, `useState`) — merge into one line (cosmetic).
- `GameMode` type / `Settings.mode` aren't used for routing — wire or drop.
- `knip` currently checks files/deps/unlisted only (not unused exports); if you add
  tests, revisit whether to also flag unused exports.
- Recruit copy + `CLAN_FULL` flag live in one component — keep them findable.

## Appendix B — Reproducing the Phase-1 transient (non-browser) tests
These ran in the cloud without being committed (to keep `package.json`/CI clean).
To re-run or port to vitest:
```
npm install --no-save jsdom preact-render-to-string@6
# Pure logic / storage tests: write a .ts entry that imports the libs, bundle with
#   node_modules/.bin/esbuild <entry>.ts --bundle --format=esm --platform=node \
#     --loader:.json=json --outfile=<out>.mjs   then `node <out>.mjs`.
#   - choices: 4 adjacent, contains truth, edges 1→{1..4} / 10→{7..10}
#   - format: 28600→"28.6"
#   - insights: perfect=100%; weak band + overestimate bias; timing→slowest band/cards
#   - elixir-lines: {n}/{time}/{insight} interpolation; unknown event → ""
#   - storage: saveResult accumulation (seen/correct/missStreak/avgMs); records/
#     profile/funnel/settings round-trips (mock globalThis.localStorage first)
#   - sampler: missed > neutral > mastered, mastered still resurfaces (floor)
# SSR render-smoke: set jsdom globals (window/document/localStorage/Image/rAF),
#   esbuild-bundle an entry that renderToString()s App + every mode, assert each
#   renders (no throw) and contains its key classes (pcard, pip-keypad, surge-ready,
#   hl-controls, budget-grid, settings__card, …). Run from the project dir so module
#   resolution finds node_modules; clean up temp files before committing.
```
Phase-1 results for reference: logic 74/74, storage/sampler 21/21, render-smoke all
9 screens render. Port these as the seed unit suite in Group 6; the **real** browser
coverage is Group 3.

## Appendix C — Open product decisions to confirm during the design pass
- Practice session length is 15 with an end-early option (decided in Phase 1).
- Surge scoring is golf time (decided). Blitz ships as a separate mode.
- Evolutions: quizzed on base elixir only; Evo/Hero shown as flavor.
- Elixir voice: "dry, a little cocky." Seed clan in-jokes/catchphrases into
  `src/lib/elixir-lines.ts`, mirroring **`jthingelstad/elixir-bot`**.
- Survival per-card clock is 5s; Deck Budget target range is 2.8–4.5 — tune to taste.
