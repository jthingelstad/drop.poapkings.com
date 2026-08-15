# CLAUDE.md - Elixir Drop Monorepo

Elixir Drop is a game for learning **Clash Royale elixir costs**, run by the POAP
KINGS clan. The public Preact application is deployed to GitHub Pages at
`drop.poapkings.com`; this monorepo also holds the Lambda player API and the
implemented fixed-IP Clash Royale API bridge.

**Doc map:** `AGENTS.md` → "Doc map" is the canonical list of every doc and what it
owns. This file is the **working guide**: golden rules, architecture, and product
decisions.

---

## Golden rules (do not violate)

1. **Keep workspace boundaries explicit.** `apps/web` owns the public browser product,
   `apps/admin` owns the private Control Room UI, `services/admin` owns its
   loopback referee adapter, `services/api` owns the TypeScript Lambda backend,
   `services/cr-api-bridge` owns fixed-IP Clash Royale access, and `infra` owns cloud definitions. Do
   not import service implementation files directly across those boundaries.
2. **Only the bridge may call the Clash Royale API at runtime.** The browser and
   Lambda backend must never call it directly. The website reads the committed
   `packages/game-data/cards.json` snapshot; dynamic backend requests (player
   enrichment, the Clan Wars clock) go through the asynchronous SQS bridge
   boundary.
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
   reused component CSS into `apps/web/src/styles.css` and its assets. No runtime
   asset link to the clan site. (The Elixir mascot emote set that this rule used
   to bundle was removed; the app icon in `assets/icon/` is the brand mark now.)
6. **Fan-content & copyright.** Card art is used under Supercell's Fan Content
   Policy: non-commercial, attributed, keep the footer disclaimer. Don't reproduce
   other copyrighted text.
7. **Referee evidence is sanitized; decisions are a bounded overlay.** Fair Play Referee
   evidence lives under `PLAYER#{sub}/EVIDENCE#` (written best-effort at
   `/runs/complete` for recorded ranked (accepted or quarantined) + unscored
   signed-in attempts; automatic scorer/integrity labels are review signals,
   never referee verdicts; never practice
   or guest) and holds the challenge, transcript, timing, versions, and
   **peppered** correlation hashes — **never a raw IP or user-agent**.
   `TELEMETRY_PEPPER` is Lambda-only: never put it in the `AGENT-TEAM/scripts`,
   the referee role, CI, or the browser. The `AGENT-TEAM/scripts` are the
   **only** sanctioned referee data and decision path; they emit the
   pseudonymous `playerId`, never `sub` or email, and fail closed. The role may
   write only `REFEREE#` decision partitions. Leaderboards honor a reversible
   `hidden`/`visible` decision without changing canonical runs or scores.
   Player-level ranked-access enforcement is a separate `REFEREE#PLAYER#`
   overlay: it requires explicit Jamie approval, blocks only future ranked
   starts, remains reversible, and never deletes the account or evidence.
   Drop Control's account-support data is a separate capability again: the
   tailnet-only `services/admin/scripts/control-*.mjs` run as
   `elixir-drop-control`, may project email/profile/CR snapshot fields, and may
   atomically correct only public profile identity fields with a `CONTROL#`
   audit event. They are never an input to the referee scripts, cannot edit
   email, runs, scores, evidence, XP, sessions, or magic links, and do not weaken
   the pseudonymous referee role.

---

## Stack & commands

- npm workspaces at the repository root; Node 24 is authoritative.
- `apps/web`: **Preact** + **@preact/signals**, **Vite**, **TypeScript**.
- `apps/admin`: **Preact** + Vite, served only through `services/admin` and
  Tailscale on the managed host; never include it in the Pages artifact.
- `npm run dev` · `npm run build` · `npm run preview` run from the repo root.
- Before pushing, run the gate that matches what you changed: `npm run verify`
  for anything under `apps/`, `services/`, `packages/`, or `infra/`, and
  `npm run verify:non-browser` for root `scripts/`, `.claude/`, `AGENT-TEAM/`,
  or prose. Four browser engines prove nothing about a commit a player cannot
  reach. **What the gate contains, and which to run, is documented once, in
  `CONTRIBUTING.md` → "The quality gate"** — don't restate it here.
- A push that changes nothing player-facing skips the browser matrix and the
  deploy in CI too. That classification fails safe and lives in `deploy.yml`'s
  `scope` job; `workflow_dispatch` always deploys.
- Deploying is one pipeline off a push to `main` (web *and* Lambda API). The model
  is stated once, in `AGENTS.md` → "Deploy model".
- `node apps/web/scripts/refresh-cards.mjs` — static card refresh; **runs only on
  the managed host**. For local development, use the committed snapshot.

The player API, infrastructure, and bridge are implemented and documented in
their workspace READMEs. Keep the request/result contracts in
`packages/contracts`; do not bypass the queues or widen the CR snapshot with
rank-oriented fields as part of unrelated work.

---

## Architecture

- **`apps/web/src/lib/storage.ts` is the local learning-data boundary.**
  All *progress* reads/writes go through it (`getProfile`, `getRecords`,
  `getCardStats`, `saveResult`, …) — never read or write a progress key directly.
  It is not the only browser-storage owner: the session token, the analytics
  login latch, and the install-prompt state are deliberately owned by
  `account.ts`, `analytics.ts`, and `pwa-install.ts`. Authenticated identity and
  signed runs use `apps/web/src/lib/account.ts`, `api.ts`, and `use-game-run.ts`.
- **Every browser-storage key uses the `elixirdrop:` prefix.** `SPEC.md` §6 holds
  the canonical inventory of all eleven keys and which module owns each; add new
  keys there.
- **Named releases have an in-app surface.** `scripts/cut-release.mjs` writes
  `apps/web/src/data/releases.json` during `npm run release:cut` (GitHub Releases
  stay the canonical history; the file is never hand-edited — the ceremony is the
  `cut-release` skill in `.claude/skills/cut-release/`). Entries flagged
  `beta: true` are backfilled pre-1.0 history — real builds that went live but
  were never named or mailed; a cut never sets that flag.
  `apps/web/src/lib/releases.ts` is the
  typed view, `/releases` renders it through `MetaPage`, and
  `components/ReleaseNotice.tsx` + `lib/release-notice.ts` show it **once** when
  the newest release id differs from `elixirdrop:releaseSeen`. A first-time
  visitor is recorded and shown nothing, and the notice never renders on a game
  route — the "never a load-time modal" rule below still binds for anything the
  player has not already been playing through. It is **not** the `UpdateBanner`:
  that one says "this tab is stale, reload"; this one says "a named release
  shipped, here's what changed". Keep them separate.
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
- **"Elixir Rain" screensaver**: activation state in
  `apps/web/src/lib/screensaver.ts` (three doors: the nav launcher — a visible
  feature, source `'nav'`; 5 logo taps; 2-min Home idle; full no-op under
  reduced motion), overlay in `components/Screensaver.tsx`, Pixi scene in
  `components/ScreensaverScene.ts` (lazy chunk via `lib/load-pixi.ts`; rotates
  the whole card catalog). It must never trigger on gameplay routes.
- **Game feedback is composited, never in layout flow.** Transient feedback
  (penalties, hints, streaks) uses the shared `components/FloatingCue.tsx`
  (motion-lib rise-and-fade) inside a `.game-cues` overlay — every mode uses it,
  so feedback can never reflow the board mid-tap. Card enter/shake/celebrate go
  through `components/GameMotion.tsx`; particle bursts through
  `components/GameFxLayer.tsx`, keyed on `runtime.cue`. The **Enhance effects**
  setting (default on; `isEnhancedEffectsEnabled()` in `lib/motion.ts`) layers
  richer bursts — including on misses — on top; **reduced motion always wins**
  (no FX). Don't hand-roll in-flow feedback text or ad-hoc CSS keyframes.
- **Practice runs offline; nothing else does.** The service worker keeps two
  caches on two clocks: card art keyed to the CATALOG version (immutable, must
  survive a release) and the app shell keyed to the BUILD id (must not, or a
  player strands on an old app). Navigation is network-first, so the cached
  shell is only ever a fallback. `/api-config.json` is never cached — a stale
  copy would aim the app at the wrong stack. When a signed start cannot be
  prepared, **Practice alone** deals locally from `lib/offline-practice.ts` and
  records nothing: no history row, no server learning stats, no badges, no XP,
  no daily streak. The screen says so. Every mode that records something still
  fails closed. This is not a hole in the signed-challenge rule: Practice is
  unranked and unscored, and the API's own Practice deal is `shuffle(pool)`
  over the whole catalog, which is exactly what the offline deal reproduces —
  the weakness weighting that decides what a player sees has always lived in
  the browser, in `lib/practice-deal.ts`. Offline is surfaced up front, not
  discovered by failing: `offline` in `lib/api-availability.ts` tracks
  `navigator.onLine` plus the online/offline events, ranked Play buttons
  disable and dim, and `components/OfflineNotice.tsx` names the mode that still
  works. It is trusted in one direction only — false means definitely offline;
  true never promises the API is reachable, which is what `ApiStatusBanner`
  still covers. **The account gate in `App.tsx` must let `/practice` through**
  when services are unreachable: Practice records nothing, so there is nothing
  for player services to be reconnecting for, and gating it made the one mode
  that works offline the one mode you could not reach.
- **Card selection is server-owned.** Signed challenges from
  `services/api/src/scoring.ts` deal every game (no immediate repeats across
  shuffle boundaries); `apps/web/src/lib/game-challenge-content.ts` resolves
  them into playable content. The old client-side `sampling.ts` is gone.
- **`apps/web/src/lib/choices.ts`** — `makeChoices(elixir)` returns four
  **adjacent** costs that contain the answer, with the window's offset chosen at
  random (a 4-cost → {1,2,3,4}, {2,3,4,5}, {3,4,5,6}, or {4,5,6,7}). The
  near-miss window is pedagogical; the random offset is what stops the option set
  from naming the answer. Used only by Practice's 4-choice input.
- **`apps/web/src/lib/card-rendering.ts`** — shared rarity labels, modifier classes, and
  Clash-style card-name tone mapping. Pair it with `apps/web/src/components/CardChrome.tsx`
  instead of hand-rolling card art/name/cost UI in a mode.
- **Player avatars are CSS crops, not derivative assets.** Shared defaults and
  exceptional per-card focal adjustments live in
  `apps/web/src/data/avatar-crops.ts`. Review the complete catalog at the
  development-only `#/avatar-audit` route before adding an override.
- **`apps/web/src/lib/run-loop.ts`** — shared countdown, timeout clearing, and elapsed-time
  helpers for timed modes.
- **`apps/web/src/lib/insights.ts`** — Practice and Surge coaching insights.
- **`apps/web/src/lib/practice-deal.ts`** — Practice's weakness-weighted draw over
  the signed deck, from local `cardStats`; uniform for a player with no stats.
- **`apps/web/src/lib/mode-insights.ts`** — mode-specific summary lines (Trade).
- **Modes** in `apps/web/src/modes/`. The six shipped, routed modes are `surge`,
  `practice`, `higher-lower`, `trade`, `survival`, and `rain`. Practice is an
  endless, unranked drill that touches no competitive or progression surface
  (`ranked: false` at /runs/start; completeRun skips the leaderboard GSI; zero
  XP; no record key). See `GAMES.md` for mechanics, backlog, and retired modes.
- **Home lists every game and features one a day.** `home-games.ts` holds all
  five ranked games in a fixed order that never changes — a player looking for
  Survival finds it in the same place every day — and the hero promotes one of
  them, chosen by UTC day so every player sees the same game and it turns over
  predictably. The rotation is the promotion slot; it must never be the only
  route to a mode. No mode carries a permanent "NEW" badge.
- **No curated deck definitions.** Do not add `decks.json`, archetype lists, or
  games that require authentic deck coherence. New modes should work from the
  committed `cards.json` facts only. (Rationale and the set-aside ideas live in
  `GAMES.md` → "Current product constraint".)
- **CR profile snapshots are practice context, not rank context.** Store CR name,
  clan, Years Played account age, and card _count_. Do not add experience,
  arenas, trophies, wins, or card levels, and do not render the CR card
  collection (removed — it has no use in Drop; the count stays). Player tags
  remain unverified ownership. Drop's own arena (below) is a native construct
  from Player XP — unrelated to CR arenas.
- **Badges are ladders, and awarding is a pure function of counters.** A badge is
  ONE monotonic counter plus an ordered rung list (`BADGES` in
  `packages/contracts`) — not three tiers. Three counter kinds: `count` and
  `best` clear on `value >= rung`, `time` clears on `value <= rung` and also
  keeps a per-rung run count. `services/api/src/badges.ts` is the whole engine
  and is pure — no I/O — so counters can be recomputed from history, which is
  what makes a badge added later retroactive. Two invariants: counters only move
  favourably, and **no valid achievement is ever revoked** (a broken daily
  streak lowers no badge; a versioned migration may remove a retired-board
  result that never met the badge requirement, and a final referee exclusion
  removes that ineligible run from the derived badge bag). Referee decisions
  append an invalidation marker; the next owner or public profile read rebuilds
  against eligible history, and a later audited restoration restores the run's
  contributions. Mode mastery credits legitimate
  historical activity, but format-comparable skill badges accept only the
  current board epoch. Storage is one
  `PLAYER#{sub}/BADGES` item, written
  best-effort *outside* the `completeRun` transaction exactly like learning
  stats — a badge failure must never roll back a recorded run. **Badges award no
  XP**: they stand alone, so a retroactive backfill cannot jump a player several
  arenas. Rungs were calibrated against the live boards on 2026-08-02, with
  Sharp Trade rechecked against its expanded 10-exchange cohort on 2026-08-06,
  not copied from the design draft; ladders with no live data behind them are
  marked "scaled" in the table and want a re-check.
- **Player XP is a per-player ACTIVITY score; the leaderboard is SKILL.** XP is
  server-computed in `services/api/src/xp.ts` (`runXp` = questions attempted in
  a run, right or wrong; floor 1), added to the `PLAYER#/PROFILE` item inside
  the `completeRun` transaction, and returned on `GET /me`, `/runs/complete`,
  and leaderboard rows. It rewards practice volume, never correctness — a
  beginner always progresses. **Practice earns zero XP**, excluded explicitly at
  the `runs-complete.ts` call site: it is endless, so per-question XP would make
  the arena farmable. XP drives the 28-tier arena in
  `apps/web/src/data/starRanks.ts` (thresholds scaled to XP), shown in the nav
  player block and profile. Leaderboards stay ranked purely on speed. The old
  games-derived "Level" is retired.
- **The global `GET /stats.trophyRoadGames` counter is site social proof only.**
  Stable launch seed of 592, increments atomically with every server-accepted
  run; surfaced on Home as "games played across Drop". It is NOT the arena/XP
  progression (that is per-player). Tinylytics is analytics only.
- **Competitive timing** uses `performance.now()` (monotonic), not `Date.now()`.
  Ranked clients attach privacy-minimized prompt-enabled/input stamps, coarse
  input kind, and `isTrusted`; never collect coordinates, pressure, pointer
  identity, or key codes. Active response time excludes forced reveal and
  card-transition waits. Preload timed card art before the clock starts.
- **Leading results rank while they wait.** A strict new season or all-time
  leader still goes to the Fair Play Referee, and automatic timing/scoring
  signals use the same neutral hold — but a held run now **ranks provisionally**
  on the public board instead of disappearing from it. Only an `excluded` run
  leaves a board. The one read that still withholds a pending run is
  `seasonPodiumFinishers`: a provisional placement is reversible, a finalized
  podium is not.
- **The vocabulary is Cleared / Awaiting / Excluded**, and the mark is the
  struck-wax seal in `components/ReviewStatus.tsx` — CSS only, no emoji, no art
  file. "Pending", "Reviewed", and "Not included in rankings" are retired from
  the UI; the API enum `pending | reviewed | excluded` is unchanged.
  `services/api/src/referee-status.ts` is the single classifier both the owner's
  history and the public boards read, so the two surfaces cannot disagree about
  the same run. Its hidden branch fails closed.
- **An unreviewed run wears no seal.** Most runs are never reviewed; they carry
  no `reviewStatus` on any surface. Cleared means a referee examined that exact
  run, so it is never the default for a run nobody examined — on a board, in
  history, or in the status counts.
- **`GET /me/seasons` is bounded.** It returns a one-row-per-season `index` plus
  a single season's runs (`season=all` is an explicit opt-in). Never reintroduce
  a read that ships a player's whole career to render one month.
- **Players read Clash Royale season numbers, never Drop's internal ids.**
  `2026-08` is a storage key; "Season 135" is the season. `crSeasonIdFor` in
  `services/api/src/seasons.ts` derives the number for a past season (monthly and
  sequential from the live war clock, or the id's own `-NN` suffix) and returns
  undefined rather than guessing. Any surface naming a season shows the number
  and falls back to the raw id only when there isn't one.

---

## Card data shape (`packages/game-data/cards.json`)

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
(1→evo, 2→hero, 3→both). `icon` = local `/cards/{id}.png` (art is mirrored —
refresh always sets `MIRROR_IMAGES=true`; CDN URLs would break WebGL textures under CSP), historically `iconUrls.medium` if
`MIRROR_IMAGES=true`.

---

## Current product decisions

- **Surge scoring:** golf time (elapsed + penalties; lower wins). Sprint of 15;
  +2.0s per wrong answer; the card stays until correct.
- **Practice input:** offer both 4-button multiple choice and the pip keypad;
  remember the choice in settings. Default to the keypad. The keypad has one key
  per cost that exists in the catalog (currently 1–9) — a dead "10" key was
  penalty bait and stole tap-target width.
- **Speedrun keyboard:** an off-by-default setting that deals the pip keypad as
  two full-width rows (1–5 over 6–9) instead of one row of nine, roughly doubling
  key width because mistaps happen sideways. Asked for by Drop's fastest Surge
  players. It applies everywhere the pip keypad renders (Surge, Practice,
  Survival, Rain) so muscle memory is the same in drill and in competition;
  Trade's swing pad is a different control and is untouched. The two-row layout
  **must not** keep the single row's `aspect-ratio`, or it blows through the
  viewport-fit gates — see `.pip-keypad--speedrun` in `styles.css`.
- **Evolutions:** quiz on **base elixir only**; show Evo/Hero as flavor, not as
  part of the answer.
- **Elixir voice:** dry, a little cocky, never mean. Short lines.
- **Daily Ladder:** deferred. Do not build it unless the user explicitly
  re-approves that mode.

---

## Key values

- Tinylytics site ID: `JjqvUeyEnrPM1f_iXrbU` (integer `3445`). The safe loader uses
  `https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU/min.js?events&beacon` and explicitly
  bridges credential-free hash routes into virtual page paths because Pages requires hash routing.
  (kudos removed — the like button was only on game summaries and is gone)
- Clan invite: `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
- Discord: `https://discord.gg/SdvKfJW5kA` — the clan is often full; lead with
  Discord when it is (mirror the site's JOIN/WAIT pattern).
- Drop contact: `drop@poapkings.com` for administration, general questions,
  privacy requests, and Fair Play re-review. Transactional player mail and
  magic links continue to send from `elixir@poapkings.com`; do not collapse the
  contact and sender roles back into one deployment parameter.
- Clan presence is **chrome, not moments**: a quiet, always-present "Run by POAP
  KINGS" footer link and the Discord link. The triggered Recruit CTA (fire on a
  new PB / strong session) was an early Elixir concept and was **removed in
  full** — its `community.*` analytics events, the `elixirdrop:funnel` counters,
  and the `elixir-lines.ts` host voice table are all gone. Don't rebuild any of
  them without the surface that justifies them, and never a load-time modal.

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
