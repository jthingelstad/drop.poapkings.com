# CLAUDE.md - Elixir Drop Monorepo

Elixir Drop is a game for learning **Clash Royale elixir costs**, run by the POAP
KINGS clan. The public Preact application is deployed through CloudFront from a
private S3 bucket at `drop.poapkings.com`; this monorepo also holds the Lambda
player API and the implemented fixed-IP Clash Royale API bridge.

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
4. **The public website remains private S3 + CloudFront with hash routing.**
   Vite uses `base: '/'`; CloudFront routes `/api/*` to API Gateway and all other
   requests to the private bucket. The deploy build needs no secrets.
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
  Tailscale on the managed host; never include it in the public web artifact.
- `npm run dev` · `npm run build` · `npm run preview` run from the repo root.
- Before pushing, run the gate that matches what you changed. Routine web work
  uses `npm run verify:quick`; backend-only and non-player-runtime work uses
  `npm run verify:non-browser`; exhaustive `npm run verify` is reserved for the
  cross-engine/high-risk cases. **What each gate contains is documented once, in
  `CONTRIBUTING.md` → "The quality gate"** — don't restate it here.
- Push validation is cancelable and cumulative; exact-head deployment is
  serialized and path-aware. The tested classifier lives in
  `scripts/classify-ci-scope.mjs`; `workflow_dispatch` takes the full path.
- Deployment mechanics and surface boundaries are stated once, in `AGENTS.md`
  → "Deploy model".
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
  It is not the only browser-storage owner: the session token, install-prompt
  state, install notice, and player-tag nudge are deliberately owned by their
  narrow modules. Authenticated identity and
  signed runs use `apps/web/src/lib/account.ts`, `api.ts`, and `use-game-run.ts`.
- **Every browser-storage key uses the `elixirdrop:` prefix.** `SPEC.md` §6 holds
  the canonical inventory of every browser-storage key and which module owns each; add new
  keys there.
- **Player updates are small static records, not releases or an API.** The three
  hand-edited sources are `apps/web/src/data/updates/features.json`,
  `seasons.json`, and `messages.json`; `apps/web/src/lib/update-data.ts` validates
  and merges them newest-first for both the **Updates** scope and `/updates/`.
  Each entry is one subject plus one Markdown paragraph. Markdown is rendered
  through a deliberately small, safe vocabulary: emphasis, code, and approved
  links; raw HTML, images, lists, and unsafe protocols fail validation. Feature
  entries also declare one allowed player-impact category, and copy is bounded to
  55 title characters and 60 body words.

  **An Update is a notification, not a changelog.** Player-visible is not
  sufficient. Add a `features.json` entry in the same change only when a returning
  player needs to know about a material, durable change to playable modes,
  learning, rules or scoring, competition, progression or rewards, access,
  sharing, identity, or account/privacy behavior. The card must be worth an unread
  dot. Never announce maintenance, bug-fix mechanics that preserve the existing
  player contract, refactors, tests, dependencies, deploys, telemetry, private
  tools, copy or naming changes, navigation or discovery tweaks, reordered content,
  diagnostics, feed mechanics, developer identity, layout, artwork, animation,
  visual restyles, or follow-up polish. A correctness fix qualifies only when it
  changes fairness, saved progress, eligibility, player data, or a fact the game
  teaches. One card represents one player outcome, not one commit; related details
  fold into the strongest qualifying card instead of producing sequels. Grow Drop
  audits editorial quality weekly and treats silence as the default. Call the Season owns routine,
  source-backed standings and Cleared final game results in `seasons.json` under its
  standing publication contract. Naming the Free Pass recipient, awarding a prize,
  other player messages, and broad communication retain the normal Jamie authority.
  Buttondown may occasionally summarize these updates for people who do not log
  in, but it is not the source of truth.
  Unread state remains the server-owned `lastOpenedUpdates` timestamp—account-level
  and deliberately not per-device, so it needs no browser key. On a first open only
  the newest three cards receive the unread/expanded treatment; the full history
  remains collapsed below them. The player feed is also separate from
  `UpdateBanner`, which only says the open app build is stale.
- **Public learning content is generated, not duplicated in the app shell.**
  `apps/web/scripts/static-pages.ts` emits the indexable `/games/`,
  `/learn-elixir-costs/`, `/elixir-costs/`, `/badges/`, `/discord/`, Game Setup,
  Fair Play, About, FAQ, Privacy, and Updates pages. It also emits `/feed.xml`,
  an RSS 2.0 projection of the same three player-update streams, with stable
  links to anchored entries in `/updates/`. The card reference reads
  `packages/game-data/cards.json`; the badge guide reads `BADGE_LIST` and must
  never publish hidden badge identities or requirements. Keep only canonical
  content URLs in `apps/web/public/sitemap.xml`; hash routes are gameplay links,
  not sitemap entries.
- **Authenticated identity is card-bound.** `favoriteCardId` must resolve in the
  canonical card snapshot. The API composes a fresh candidate slate from
  reviewed card-specific flavor tiles and safe humor patterns; Claude Haiku
  selects opaque candidate IDs and never authors displayable name text. Every
  catalog card must have a flavor profile before verification passes. The
  public name may use community nicknames and playful card associations instead
  of the exact card title.
  Name-option tokens bind the player, card ID, and exact safe choices; the API
  saves favorite card and public name together. Keep player tags separate and
  explicitly unverified.
- **Every new run uses the full canonical catalog and ranks.** Linked Clash
  Royale collection data remains on the player profile for future features but
  never changes challenge selection. The optional `ranked` field remains only
  so historical unranked runs can be read safely.
- **Learning stats are server-owned** (`services/api/src/learning.ts`): derived
  from validated transcripts at completion, stored per player, and returned in
  the GET /me learning summary for possible future coaching. Practice may send
  bounded first-response time and an assistance flag with each validated answer;
  the browser never uploads aggregate stats. They do not affect official
  challenge selection. Device-local stats drive Practice's adaptive deal and
  preserve the same coaching behavior offline.
- **Glyphs come from lucide-static** through `apps/web/src/components/Icon.tsx`
  (build-time inlined, currentColor). Don't hand-type arrows or symbols.
- **A recorded run, earned badge rung, or the signed-in player's profile publishes one permanent, personalized link.**
  `POST /runs/{runId}/share` resolves the caller's immutable history row and
  idempotently publishes `/share/{playerTag}/{runTag}` using Drop's existing
  `P…` and `D…` public tags; UUIDs remain internal. Summary and You → Log use the
  same action, so an old run can be shared later. The browser renders the
  server-supplied frozen snapshot through the same canvas, Clash font, and PNG
  art pipeline as badge cards, then uploads the validated 1200 × 630 PNG before
  giving the native share sheet only `{ url }`. Without a native sheet it copies
  that same URL; there is no attached file or save-image fallback. CloudFront
  sends the clean route to Lambda, which serves crawlable Open Graph HTML and
  the preview from a dedicated retained private S3 bucket. The API derives the
  bounded chart from validated referee evidence and retains the public-safe
  projection with history. The standard client renders that frozen projection;
  the API-owned title, description, alt text, and run facts remain authoritative.
  An earned badge uses the parallel
  `/share/{playerTag}/badge/{badgeSlug}/{rung}` address, where `rung` is the
  one-based earned milestone. The owner can publish it from their badge modal;
  the API independently verifies the earned rung, freezes its public badge and
  player facts, and accepts the same exact 1200 × 630 canvas PNG. Badge and run
  previews intentionally share one visual frame, real Clash font, local PNG
  art, landing shell, URL-only native-share behavior, and retained S3 bucket.
  A profile uses `/share/{playerTag}` and is refreshed through owner-only `POST
  /me/share`; the browser publishes its current arena, Player XP, and prominent
  badge highlights through the same compositor and PNG upload path. Profile
  sharing is available from the signed-in player's You header and Home hero,
  never from another player's public profile. The permanent landing remains
  public and carries Recruiter attribution without advancing Herald.
  A frozen public snapshot keeps a published link stable. Practice,
  guest, offline, missing, and Fair Play-excluded runs fail closed; account
  deletion removes the snapshot, open markers, and S3 prefix. Existing
  `#/r/<token>` links remain readable as a compatibility route.
- **Herald is result reach; Recruiter is account creation.** A crawler fetching
  the landing HTML or preview image earns nothing. Only the landing page's
  browser callback can record a distinct, non-owner open; a peppered one-way
  hash dedupes it and credit stops at 25 per published run. The clean run link
  also supplies 30-day last-touch Recruiter attribution. Badge links supply the
  same Recruiter attribution but never advance Herald; signed-in Home shares the
  player's permanent profile link. Already-issued six-character `#/s/<token>`
  invitation and badge invitation links remain readable. Requesting a login email does not
  count, while successful magic-link redemption that creates a genuinely new
  profile advances Recruiter exactly once. Anonymous players are asked to sign
  in before sharing because no account exists to receive either badge.
- **Desktop is a viewport shell over the same routes and data.** On initial load
  at or above 1024px, `MobileShell` composes a fixed 936 × 720 navigation / stage
  / activity grid (`lib/use-layout.ts`); the document itself does not scroll.
  Later browser resizes never swap or reflow that shell: a smaller viewport
  clips it. Its center is
  a fixed 440px track and Home is ONE component on both shells (`screens/Home.tsx`,
  no `layout.value` branch) in the exact mobile sequence: featured game, the
  remaining ranked games, then Practice. The featured mode is never duplicated;
  standings stay in the persistent Ladder navigation. Both rails stretch to the
  column's height, and they split by kind: the LEFT rail is everything *about*
  the app — nav, then the Falling Cards control and the meta links at its foot —
  and the right aside is the one thing *happening*, which is why the live feed
  gets the height and the controls do not. Active games
  drop both rails, use a bounded 480px stage, and remain playable with mouse or
  keyboard on the existing boards. **Falling Cards is optional desktop
  scenery** (`components/shell/DesktopWallpaper.tsx`): the full three-layer
  Pixi scene starts off and can run behind Home, reading pages, and games. It
  keeps a bounded 30-card texture cast and swaps six cards every 20 seconds so
  the catalog rotates through without living in memory all at once; reduced
  motion freezes the same composition. `DesktopAside` keeps only the live
  `Recent runs` feed; the Falling Cards control sits in `DesktopNav`'s foot.
  That control cycles off ->
  subtle -> background -> full screen: Subtle runs the same live scene at lower
  opacity; full screen hides the game panels over the same canvas, its
  dismissing input restores the panels with cards off, and the next press deals
  the Subtle scene back in. The home-row mapping (`ASDFG` = 1–5, `JKL;` = 6–9)
  binds `event.code`, never `event.key` — AZERTY's home row is *qsdfg* — and is
  stated in exactly one place in the running app: **the letter on each keycap
  mid-run**, gated on `(hover: hover) and (pointer: fine)` rather than viewport
  width. No hero hint and no rail key block: both teach a mapping where it
  cannot be used. Where `navigator.keyboard.getLayoutMap()` resolves, the caps
  print the player's own legend; a wrong letter is worse than a generic one, so
  nothing is substituted otherwise. The number row remains an alias, Space
  repeats/defaults, `?` opens the help sheet, and Escape requires two presses to
  abandon a run. **A keyboard run and a thumb run go on the same board** — no
  split board, filter, input badge, or asterisk in a referee verdict.
- **"Elixir Rain" screensaver**: activation state in
  `apps/web/src/lib/screensaver.ts` (three doors: the nav launcher — a visible
  feature, source `'nav'`; 5 logo taps; 2-min Home idle; full no-op under
  reduced motion), overlay in `components/Screensaver.tsx`, Pixi scene in
  `components/ScreensaverScene.ts` (lazy chunk via `lib/load-pixi.ts`; rotates
  a bounded cast through the whole card catalog). The desktop scene is allowed
  behind gameplay; automatic screensaver activation must never trigger there.
- **Game feedback is composited, never in layout flow.** Transient feedback
  (penalties, hints, streaks) uses the shared `components/FloatingCue.tsx`
  (motion-lib rise-and-fade) inside a `.game-cues` overlay — every mode uses it,
  so feedback can never reflow the board mid-tap. Card enter/shake/celebrate go
  through `components/GameMotion.tsx`; particle bursts through
  `components/GameFxLayer.tsx`, keyed on `runtime.cue`. The **Enhance effects**
  setting (default on; `isEnhancedEffectsEnabled()` in `lib/motion.ts`) layers
  richer bursts — including on misses — on top; **reduced motion always wins**
  (no FX). Don't hand-roll in-flow feedback text or ad-hoc CSS keyframes.
- **Every game runs offline; offline runs never record.** The service worker
  keeps two caches on two clocks: card art keyed to the CATALOG version
  (immutable, survives a release) and the app shell keyed to the BUILD id (must
  not, or a player strands on an old app). Navigation is bounded network-first:
  a responsive connection gets the current document, while a connection that
  stalls for three seconds falls back to the last complete shell.
  `/api-config.json` is never cached. Every
  production visit warms all six lazy game chunks before atomically committing
  the shell, then fills the complete base-art pack in small serialized batches.
  When `navigator.onLine === false` **or the shared API boundary classifies a
  network error, timeout, or 5xx response as unavailable**, `lib/offline-run.ts`
  deals a tokenless run locally from the shared challenge generator. It is never
  submitted or queued: no personal/season record, history, server learning
  stats, badges, XP, daily activity, global game count, or leaderboard entry.
  Device-local card stats may still sharpen future drills. Reconnecting never
  promotes that run; a signed online run that disconnects retains the normal
  completion retry instead.
  A ranked mode whose start request establishes the outage also falls back to a
  local run; an already-started signed run still retains its retryable official
  completion and is never downgraded after the fact. Offline is surfaced up
  front through a header cause chip (`components/CauseChip.tsx`, "OFFLINE" /
  "GUEST"), game chrome, and the result summary. A
  persistent state gets a persistent mark, never a standing banner. `offline` in
  `lib/api-availability.ts` combines the browser transport verdict with the
  shared API availability signal, because `navigator.onLine` being true never
  promises the API is reachable. There is no outage error or manual retry panel;
  a quiet health probe on focus, visibility, restored transport, or a 30-second
  interval restores connected mode after a successful response. **The redesign
  names the cause, not the consequence: offline, the player stays on the real
  Ladder and You page they asked for — the page shows a cause chip, renders
  absent server data quietly (bests/ranks as `—`, the arena bar greyed "Last
  known"), and the Boards scope shows "Boards need a connection" — rather than a
  route takeover. The nav never renames itself; the bundled Offline page and the
  offline nav-tab swap are retired.** The account, profile-setup, and
  ranked-access gates must let every effectively offline game through because no
  official run exists to protect or record.
- **Official card selection is server-owned; deal rules are shared.**
  `packages/contracts/src/challenge-generation.ts` is the pure challenge factory
  used by the API for signed official runs and by the browser for tokenless
  offline runs. `apps/web/src/lib/game-challenge-content.ts` resolves either
  source into playable content. The server remains the only issuer and scorer of
  an official run; the old client-side `sampling.ts` remains gone.
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
  the signed deck, from local `cardStats`; inaccurate and slow recall outweigh
  assisted recognition, and a player with no stats gets a uniform deal.
- **`apps/web/src/lib/practice-review.ts`** — Practice's guaranteed short-gap
  retry and longer confirmation queue. Keep this distinct from the long-term
  weakness weighting.
- **`apps/web/src/lib/mode-insights.ts`** — mode-specific summary lines (Trade).
- **Modes** in `apps/web/src/modes/`. The six shipped, routed modes are `surge`,
  `practice`, `higher-lower`, `trade`, `survival`, and `rain`. Practice is an
  endless, unranked drill that touches no competitive performance surface
  (`ranked: false` at /runs/start; completeRun skips the leaderboard GSI and
  personal-best record). Signed-in online Practice still awards one Player XP
  per two resolved cards with a durable odd-card carry. See `GAMES.md` for
  mechanics, backlog, and retired modes.
- **Play opens on a full-bleed hero panel** (`9a`). The panel runs to the top of
  the screen and carries the `ELIXIR DROP` wordmark plus the player's XP and
  avatar across its top — the one place identity appears on Play, and a shortcut
  to You rather than a second profile surface. Signed out, a `GUEST` shortcut
  occupies the avatar's right-side slot and opens that same You surface. Inside
  it: the
  season pill (`Season 135 · 6d 04h`, lavender — distinct from the PLAY
  actions), 72px mode art, the name, one **full-width play-icon + PLAY** CTA
  that never repeats the mode name, and `Your best … │ Rank …` beneath it as a
  footnote to the button. Dots only, no chevrons. Game rows are a flat list with
  hairline separators, not a stack of cards; each remaining ranked row repeats
  the gold play-icon + PLAY pill while Practice uses the one purple variant.
  The full row remains the tap target. **On desktop the hero topbar is hidden**:
  `12a` keeps the wordmark and the player in the left rail, and the 34px it
  returns is what keeps the arena on one screen.
- **Home lists every game and features one a day.** `home-games.ts` holds all
  five ranked games in a fixed order that never changes — a player looking for
  Survival finds it in the same place every day. The first hero slide promotes
  one ranked game chosen by UTC day; two hard-coded slides promote the current
  designated Free Pass game and sharing Drop. The Free Pass rotates by explicit
  season designation: Surge is current and Rain is next; later games must be
  named in `GAMES.md`, never inferred. Changing the promotion requires a code
  release. The carousel must never be the only route to a mode. Each All
  Games card highlights the player's own all-time best, not the current board
  leader. Rankings stay on the dedicated Ranks surface rather than trailing
  the mobile Games page. No mode carries a permanent "NEW" badge.
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
  favourably, and **no valid achievement is ever revoked** (a versioned
  migration may remove a retired-board
  result that never met the badge requirement, and a final referee exclusion
  removes that ineligible run from the derived badge bag). Referee decisions
  append an invalidation marker; the next owner or public profile read rebuilds
  against eligible history, and a later audited restoration restores the run's
  contributions. Mode mastery credits legitimate
  historical activity, but format-comparable skill badges accept only the
  current board epoch. Storage is one
  `PLAYER#{sub}/BADGES` item, written
  best-effort *outside* the `completeRun` transaction exactly like learning
  stats — a badge failure must never roll back a recorded run. Every earned
  rung awards exact-once Player XP from the shared contract (copper 5, silver
  10, gold 25, prismatic 50, hidden single-rung 25, Battle Tag 100, Collector
  100). The profile
  read path retroactively reconciles every existing rung, and then settles the
  finite badge XP → Arena Climber → badge XP cascade; markers prevent replay and
  awarded XP is never clawed back. Rungs were calibrated against the live boards on 2026-08-02, with
  Sharp Trade rechecked against its expanded 10-exchange cohort on 2026-08-06,
  the five Tyler-tested volume/skill ladders plus Daily Drop reworked on
  2026-08-16, and five prismatic ceilings revised in the 2026-08-20 product
  review. Daily Drop counts distinct played days, never a streak. The rungs
  are not copied from the design draft; ladders with no live data behind them
  are marked "scaled" in the table and want a re-check.
  Battle Tag is a visible one-time badge derived from the optional unverified
  player tag. Herald reads the existing distinct shared-run open counter;
  Recruiter credits the sharer when a newly attributed account is created.
- **Player XP is permanent progression; the leaderboard is performance.**
  `packages/contracts/src/index.ts` is the one XP v2 rulebook used by the API,
  browser, and generated `/xp/` page. Recorded Surge pays 15 and Trade 100;
  Higher / Lower, Survival, and Rain pay nuanced score bands (0–4 equals the
  score, then 10–125); Practice pays one per two validated cards with a durable
  odd-card carry and no payout cap. Exact-once marker transactions add +10 for
  an official current-board personal best (first counts, max three per UTC day),
  +5 for the first qualifying UTC featured completion, badge rung XP, top-20
  season placement XP from Season 135 / `2026-08` onward
  (500/350/250/150/100/50), and +100 Seasonal Circuit for
  a positive final score in all five ranked modes. Current XP is the immutable
  opening balance; only badge rungs backfill. Offline and guest runs award
  nothing. XP drives the 28-tier arena in
  `apps/web/src/data/starRanks.ts` (thresholds scaled to XP), shown in the nav
  player block and profile. Leaderboards stay ranked purely on speed. The old
  games-derived "Level" is retired.
- **Account tags are identity, never progression or authority.** The API maps
  permanent public player IDs to a shared allowlist of public account tags and
  projects them onto owner, public-profile, and leaderboard responses. `DEV`
  marks Drop's developers beside their names; it is not a badge, earns no XP,
  changes no rank, and grants no API or referee capability. The browser owns the
  compact Drop-styled label while the server owns who receives it.
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
  +2.0s per wrong answer; the card stays until correct. Every timed-game display
  uses three decimal places, matching the millisecond precision used to order
  leaderboards.
- **Practice input:** offer both 4-button multiple choice and the pip keypad;
  remember the choice in settings. Default to the keypad. The keypad has one key
  per cost that exists in the catalog (currently 1–9) — a dead "10" key was
  penalty bait and stole tap-target width.
- **Practice learning:** keep the mode endless, unscored, and without a progress
  bar or share action. Time first responses invisibly; separate requested help
  from recall; offer a voluntary scaffold after seven idle seconds; give keypad
  recall one anchored higher/lower retry before revealing the exact value; and
  return misses through the spaced-review queue. The solved cost must hold over
  the card for at least 300ms and leave attached to that card.
- **Two-row keypad:** the pip keypad is always dealt as two full-width rows (1–5
  over 6–9), roughly doubling key width because mistaps happen sideways. Asked for
  by Drop's fastest Surge players, and now the ONLY layout — the old single row of
  nine and the opt-in "Speedrun keyboard" setting were removed in the 2026 refresh
  (`SPEEDRUN_TOP_ROW = 5` stays: a future 10-cost card lands on the bottom row,
  not shoving 1–5 out from under a learned thumb). It renders everywhere the pip
  keypad does (Surge, Practice, Survival, Rain); Trade uses the shared
  `components/game/ExchangeBoard.tsx` (RED/BLUE team rows + EVEN) instead. The two
  rows **must not** keep a single row's `aspect-ratio`, or they blow through the
  viewport-fit gates — see `.pip-keypad` in `styles.css`.
- **Evolutions:** quiz on **base elixir only**; show Evo/Hero as flavor, not as
  part of the answer.
- **Elixir voice:** dry, a little cocky, never mean. Short lines.
- **Daily Ladder:** deferred. Do not build it unless the user explicitly
  re-approves that mode.

---

## Key values

- Tinylytics site ID: `JjqvUeyEnrPM1f_iXrbU` (integer `3445`). The safe loader uses
  `https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU/min.js?events&beacon` and explicitly
  bridges credential-free hash routes into virtual page paths because Drop
  retains hash routing.
  Browser events own interaction intent; `services/api/src/tinylytics.ts` sends authoritative
  login/profile and recorded-game outcomes through the numeric property API. The two surfaces
  must never emit the same logical occurrence.
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
- Run the change-specific final gate in `CONTRIBUTING.md` before pushing.

When a decision is genuinely ambiguous and not covered above, in `SPEC.md`, or in
`GAMES.md`, stop and ask rather than guessing.
