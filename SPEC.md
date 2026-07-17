# Elixir Drop - Current Implementation Spec

**A Clash Royale elixir-cost learning game, run by POAP KINGS.**

`SPEC.md` is still useful, but no longer as a pre-build checklist. Keep it as the
current implementation reference: product boundaries, architecture, data flow,
storage, analytics, deployment, and maintenance rules. `GAMES.md` remains the
canonical source for shipped modes and game ideas.

---

## 1. Product Boundary

- **Name:** Elixir Drop
- **URL:** `drop.poapkings.com`
- **Owner:** POAP KINGS (clan tag `#J2RGCRVG`)
- **Primary goal:** build fast, accurate intuition for Clash Royale card elixir
  costs and elixir trades.
- **Secondary goal:** create earned recruiting moments for POAP KINGS.
- **Host / mascot:** Elixir, bundled as local assets in this repo.

Elixir Drop is a self-contained static app. It has no backend, no accounts, no
server leaderboard, and no runtime dependency on `poapkings.com` or the Elixir
Discord bot's stores.

The only outbound ties are ordinary links:

- POAP KINGS site: `https://poapkings.com`
- Clan invite:
  `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
- Discord: `https://discord.gg/kBD62fYHWx`
- Supercell / fan-policy attribution links

Hard product constraints:

- Do not call the Clash Royale API from the browser or CI.
- Do not put the CR API token in client code, CI, or committed files.
- Do not add curated deck definitions, archetype lists, or game modes that depend
  on authentic deck construction.
- New game modes should work from the committed facts in `src/data/cards.json`.

---

## 2. Runtime Stack

| Layer       | Current choice                                                         |
| ----------- | ---------------------------------------------------------------------- |
| UI          | Preact                                                                 |
| State       | `@preact/signals`                                                      |
| Build       | Vite + TypeScript                                                      |
| Routing     | Hash routing through `src/lib/router.ts`                               |
| Styling     | Vendored POAP KINGS-inspired tokens and components in `src/styles.css` |
| Persistence | `localStorage` through `src/lib/storage.ts`                            |
| Analytics   | Tinylytics, Elixir Drop's own property                                 |
| Hosting     | GitHub Pages, custom domain `drop.poapkings.com`                       |
| Deployment  | `.github/workflows/deploy.yml` on push to `main`                       |

The app builds to static files in `dist/`. GitHub Pages serves the custom domain
from root, so Vite `base` stays `/` and routes stay hash-based to avoid Pages
404s.

---

## 3. Card Data

All card facts originate from the official Clash Royale API `/cards` endpoint,
but the running app reads only the committed snapshot:

```text
src/data/cards.json
```

Current snapshot:

- `version`: `2026-06-13`
- `count`: `120`

The API is refreshed out-of-band because:

1. Browser calls fail CORS.
2. CR developer tokens are IP-allowlisted, so CI runners cannot safely fetch the
   data.

Refresh model:

- A checkout on a managed host has an allowlisted IP.
- The token lives in `.env` as `CR_API_TOKEN`; `.env` is gitignored.
- `scripts/refresh-cards.mjs` fetches `/cards`, normalizes the response, diffs it
  against `src/data/cards.json`, and commits only when the snapshot changes.
- A push from that host triggers the normal GitHub Pages build.
- `MIRROR_IMAGES=false` hotlinks Supercell CDN card art; `true` can mirror art
  into `public/cards/` without changing game code.

Normalization rules:

- Use standard `items` with `elixirCost`.
- Exclude `supportItems` because Tower Troops have no elixir cost.
- Emit `{ id, name, elixir, rarity, type, evo, hero, icon }`.
- Derive `type` from ID range: `26` troop, `27` building, `28` spell.
- Use `iconUrls.medium` by default.

The API reference under `docs/cr-agent-api-docs/` is the source material for
these assumptions.

---

## 4. Shipped Modes

`GAMES.md` is authoritative for mode mechanics, backlog, and retired ideas. The
current shipped app has ten playable modes:

| Mode           | Route              | Score / record                               |
| -------------- | ------------------ | -------------------------------------------- |
| Surge          | `#/surge`          | `surgeBest`, lowest 15-card sprint time      |
| Practice       | `#/practice`       | `bestAccuracy`, best 15-card accuracy        |
| Identify       | `#/identify`       | `identifyBest`, lowest card-name sprint time |
| Higher / Lower | `#/higher-lower`   | `longestStreak`                              |
| Trade          | `#/trade`          | `tradeBest`, lowest 8-exchange time          |
| Blitz          | `#/blitz`          | `blitzBest`, most cleared in 60 seconds      |
| Survival       | `#/survival`       | `survivalBest`, longest sudden-death streak  |
| Speed Ladder   | `#/ladder`         | `ladderBest`, lowest sort time               |
| Endless Ladder | `#/endless-ladder` | `endlessLadderBest`, most inserts            |
| Cost Sweep     | `#/cost-sweep`     | `costSweepBest`, most target cards in 45s    |

Product decisions currently in force:

- Surge, Identify, Trade, and Speed Ladder are golf-time modes: lower is better.
- Wrong timed answers add `+2.0s` and leave the prompt live until solved.
- Practice defaults to the pip keypad and also offers 4-button choices.
- Evolutions and Hero flags are flavor only; the answer is always base elixir.
- Daily Ladder is not shipped and should not be built without a fresh approval.

---

## 5. Shared Game Systems

Important shared modules:

- `src/lib/storage.ts` - all localStorage reads/writes.
- `src/lib/sampling.ts` - weighted card sampling.
- `src/lib/choices.ts` - adjacent elixir distractors.
- `src/lib/name-choices.ts` - card-name distractors.
- `src/lib/preload.ts` - image preloading for timed runs.
- `src/lib/run-loop.ts` - countdown, timeout clearing, and elapsed-time helpers.
- `src/lib/endless-ladder.ts` - insertion-slot validation for Endless Ladder.
- `src/lib/cost-sweep.ts` - target tracking for Cost Sweep boards.
- `src/lib/card-rendering.ts` - shared card rarity labels, modifier classes, and
  Clash-style name tone mapping.
- `src/lib/insights.ts` - Practice and Surge coaching insights.
- `src/lib/mode-insights.ts` - mode-specific Identify, Trade, and Ladder summary
  lines.
- `src/lib/elixir-lines.ts` - static host lines; no LLM at runtime.
- `src/lib/analytics.ts` - Tinylytics custom event bridge and local funnel mirror.

Timing rules:

- Use `performance.now()` for elapsed-time math.
- Clear all scheduled timers when a timed mode unmounts.
- Preload timed-run card art before the countdown begins.

Active-play layout:

- Timed run states use `.game-run`.
- During active play, the header is compact and the footer/star counter are
  hidden so the play surface stays clean on mobile.
- E2E coverage should keep checking active controls are visible and there is no
  horizontal overflow.

---

## 6. Storage

All persistence goes through `src/lib/storage.ts`.

```text
elixirdrop:profile    -> { createdAt, nickname?, totalSessions }
elixirdrop:cardStats  -> { [id]: { seen, correct, missStreak, lastSeen, avgMs? } }
elixirdrop:records    -> { surgeBest, longestStreak, bestAccuracy, identifyBest,
                           blitzBest, survivalBest, ladderBest, tradeBest,
                           endlessLadderBest, costSweepBest }
elixirdrop:funnel     -> { recruitShown, recruitJoin, recruitDiscord, shares }
elixirdrop:settings   -> { inputStyle, sound, reducedMotion? }
```

This is the v2 API boundary: if accounts or server records arrive later, replace
the storage function bodies without rewriting game modes.

---

## 7. Analytics And Recruiting

Tinylytics property:

- Site ID: `JjqvUeyEnrPM1f_iXrbU`
- Integer ID: `3445`

Analytics are best-effort and must never block gameplay.

Tracked events include:
`game.start`, `mode.practice`, `mode.identify`, `mode.surge`,
`mode.higherlower`, `mode.trade`, `mode.blitz`, `mode.survival`, `mode.ladder`,
`mode.endless`, `mode.costsweep`, `identify.complete`, `surge.complete`,
`ladder.complete`, `trade.complete`, `endless.complete`, `costsweep.complete`,
`record.new`, `recruit.shown`, `recruit.join`, `recruit.discord`, `result.share`.

Recruitment remains moment-based:

- Trigger on strong summaries or new records, not load-time modals.
- Keep the persistent footer quiet.
- Lead with Discord when the clan is full.

---

## 8. Design And Assets

Elixir Drop vendors its own visual layer:

- `src/styles.css` contains the local tokens and components.
- `public/assets/` contains Elixir art, emoji states, arena images, fonts, OG
  image, favicon, and star asset.
- Card art hotlinks the Supercell CDN unless `MIRROR_IMAGES` is enabled during a
  data refresh.
- `docs/clash-royale-screenshots/` contains local visual references for card
  frames, elixir badges, and rarity-colored text treatment.
- `docs/card-rendering.md` documents the current card-rendering findings and the
  shared helper surface: `src/components/CardChrome.tsx`,
  `src/lib/card-rendering.ts`, and the `cr-*` CSS classes.

Card rendering rules:

- Do not render fake card levels. Elixir Drop has card facts, not player-owned
  level data.
- Use rarity color where Clash Royale uses level/color treatment: common blue,
  rare orange, epic purple/pink, legendary teal/mint, champion gold.
- Prefer the shared `CardArt`, `CardName`, and `ElixirCostBadge` helpers for new
  or changed card surfaces.

Keep the footer Supercell disclaimer. This is an unofficial, non-commercial fan
project and is not endorsed by Supercell.

---

## 9. QA And Deployment

Use this before pushing:

```bash
npm run verify
```

`verify` runs:

- Prettier format check
- ESLint
- Stylelint
- TypeScript typecheck
- Knip
- Vitest unit tests
- Chromium Playwright e2e tests
- Production build

GitHub Actions runs the same verification path on push to `main`, after
installing Chromium with Playwright. The Pages artifact is uploaded from `dist/`
only after verification passes.

Current e2e coverage includes:

- Route accessibility smoke checks.
- Card art fallback.
- Identify completion behavior.
- Speed Ladder desktop and mobile interactions.
- Endless Ladder insertion behavior.
- Cost Sweep target clearing.
- Trade exchange hints.
- Settings persistence.
- Active timed states using low chrome with visible controls.

---

## 10. Open Operations

The remaining non-code operation is the card refresh host:

- Confirm or maintain the managed host that owns the allowlisted CR API token.
- Keep `.env` local to that host.
- Keep push credentials scoped to the repo.
- Run `scripts/refresh-cards.mjs` manually after known Supercell updates or on a
  conservative cron.

Everything else needed for v1 is in-repo and deployed through GitHub Pages.

---

_Unofficial fan project. Card data, names, and artwork © Supercell, used under
Supercell's Fan Content Policy. Not endorsed by Supercell._
