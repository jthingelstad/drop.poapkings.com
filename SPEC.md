# Elixir Drop - Current Implementation Spec

**A Clash Royale elixir-cost learning game, run by POAP KINGS.**

`SPEC.md` is the current implementation reference: product boundaries,
architecture, data flow, storage, analytics, deployment, and maintenance rules.
It records the monorepo boundaries and the implemented player API. `GAMES.md`
remains the canonical source for shipped modes and game ideas.

---

## 1. Product Boundary

- **Name:** Elixir Drop
- **URL:** `drop.poapkings.com`
- **Owner:** POAP KINGS (clan tag `#J2RGCRVG`)
- **Primary goal:** build fast, accurate intuition for Clash Royale card elixir
  costs and elixir trades.
- **Secondary goal:** create earned recruiting moments for POAP KINGS.
- **Host / mascot:** Elixir, bundled as local assets in this repo.

The public website remains a static GitHub Pages app, but it now uses a separate
Lambda API for email magic-link accounts, profiles, signed runs, progression,
global game totals, and seasonal leaderboards. The site and leaderboards remain
public. Anyone can play every mode **without an account as a guest**: a guest run
is dealt the same server-signed challenge and scored the same way, but nothing is
recorded (no leaderboard, no all-time, no XP, no history, no Discord) — the
summary nudges the visitor to sign in to save the score. An email-authenticated
player session unlocks recording and ranking. Dynamic Clash Royale player
enrichment and the global Clan Wars clock run asynchronously through the fixed-IP
bridge.

The only outbound ties are ordinary links:

- POAP KINGS site: `https://poapkings.com`
- Clan invite:
  `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
- Discord: `https://discord.gg/SdvKfJW5kA`
- Supercell / fan-policy attribution links

Hard product constraints:

- Do not call the Clash Royale API from the browser, CI, or Lambda.
- Only the fixed-IP bridge may call the Clash Royale API at runtime.
- Do not put the CR API token in client code, Lambda, CI, or committed files.
- Do not add curated deck definitions, archetype lists, or game modes that depend
  on authentic deck construction.
- New game modes should work from the committed facts in
  `packages/game-data/cards.json`.

---

## 2. Repository And Runtime Stack

The repository uses npm workspaces:

| Workspace / directory    | Responsibility                               | Status      |
| ------------------------ | -------------------------------------------- | ----------- |
| `apps/web`               | Public Preact game                           | Implemented |
| `services/api`           | TypeScript Lambda player and game API        | Implemented |
| `services/cr-api-bridge` | Fixed-IP Clash Royale API worker             | Implemented |
| `packages/contracts`     | Shared browser/server TypeScript contracts   | Implemented |
| `packages/game-data`     | Canonical card facts                         | Implemented |
| `infra`                  | CloudFormation and SDK deployment automation | Implemented |

The API uses API Gateway HTTP API, Lambda, DynamoDB, SQS, Fastmail JMAP, Bedrock,
and CloudFormation. The local bridge long-polls SQS with its own queue-only IAM
credentials, refreshes the Clan Wars clock every five minutes, and returns
normalized player or clock results through a second queue.

Current public website stack:

| Layer       | Current choice                                              |
| ----------- | ----------------------------------------------------------- |
| UI          | Preact                                                      |
| State       | `@preact/signals`                                           |
| Build       | Vite + TypeScript                                           |
| Routing     | Hash routing through `apps/web/src/lib/router.ts`           |
| Styling     | Vendored tokens and components in `apps/web/src/styles.css` |
| Persistence | `localStorage` through `apps/web/src/lib/storage.ts`        |
| Analytics   | Tinylytics, Elixir Drop's own property                      |
| Hosting     | GitHub Pages, custom domain `drop.poapkings.com`            |
| Deployment  | `.github/workflows/deploy.yml` on push to `main`            |

The app builds to static files in `apps/web/dist/`. GitHub Pages serves the
custom domain from root, so Vite `base` stays `/` and routes stay hash-based to
avoid Pages 404s.

---

## 3. Card Data

All card facts originate from the official Clash Royale API `/cards` endpoint,
but the running app reads only the committed snapshot:

```text
packages/game-data/cards.json
```

Current snapshot:

- `version`: `2026-07-19`
- `count`: `120`

The API is refreshed out-of-band because:

1. Browser calls fail CORS.
2. CR developer tokens are IP-allowlisted, so CI runners cannot safely fetch the
   data.

Refresh model:

- A checkout on a managed host has an allowlisted IP.
- The token lives only on the fixed-IP managed host; `.env` is gitignored.
- `apps/web/scripts/refresh-cards.mjs` fetches `/cards`, normalizes the response,
  diffs it against `packages/game-data/cards.json`, and commits only when the
  snapshot changes.
- A push from that host triggers the normal GitHub Pages build.
- Card art is **mirrored and committed** under `apps/web/public/cards/`
  (`cards.json` icons point at local `/cards/{id}.png` paths). The refresh
  host keeps `MIRROR_IMAGES=true` in the root `.env` — a bare refresh would
  revert icons to CDN URLs, which the page CSP's `connect-src` blocks for
  WebGL texture loads (the screensaver) and which reintroduces a CDN
  dependency for gameplay art.

The static refresher and local bridge are the only implemented Clash Royale API
consumers. Dynamic backend work must be queued for
`services/cr-api-bridge`; Lambda and browsers never call CR directly.

The runtime clock combines POAP KINGS' `/currentriverrace` section, period, and
phase with the sequential season ID in `/riverracelog`. Daily-reset math is
anchored on the latest observed race close (the reset hour drifts per season),
falling back to 10:00 UTC. The result Lambda stores one current clock in
DynamoDB. Completed runs and leaderboard reads use its stable
leaderboard-season mapping; a changed CR season ID is the authoritative reset
signal. The UI shows the CR season, current week, phase, and days left in the
war week. A clock older than two hours keeps naming the stored leaderboard
season for as long as the season it observed can run (five weeks) — a bridge
outage must not split the leaderboard mid-season — and only after that does the
first-Monday calendar fallback take over.

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
app has five playable modes:

| Mode           | Route            | Score / record                              |
| -------------- | ---------------- | ------------------------------------------- |
| Surge          | `#/surge`        | `surgeBest`, lowest 15-card sprint time     |
| Practice       | `#/practice`     | `bestAccuracy` — **unranked by design**     |
| Higher / Lower | `#/higher-lower` | `longestStreak`                             |
| Trade          | `#/trade`        | `tradeBest`, lowest 8-exchange time         |
| Survival       | `#/survival`     | `survivalBest`, longest sudden-death streak |

Practice runs are created `ranked: false` server-side: they record to history
and Trophy Road but never write a leaderboard entry, and Practice has no
leaderboard tab.

Each ranked mode has two boards, selected by the `scope` query param on
`GET /leaderboards` (`season`, the default, or `all-time`):

- **Season** is the existing per-season board: every completed ranked run writes
  a history row into GSI1 under `LEADERBOARD#{seasonId}#{mode}`, and a read
  dedups to each player's best run in that season.
- **All-time** ranks a player's best-ever score per mode across all seasons. It
  stores exactly one best item per player per ranked mode at
  `pk = PLAYER#{sub}`, `sk = ALLTIME#{mode}`, indexed into the same GSI1 under
  `LEADERBOARD#ALLTIME#{mode}` with the identical sort-key encoding (better
  score/tiebreak → smaller key). A completion updates it best-effort after
  `completeRun`, guarded by `attribute_not_exists(GSI1SK) OR :newSk < GSI1SK`;
  a run that is not a new best fails the condition and is silently skipped, so
  the recorded run never rolls back. Because there is one item per player, the
  read needs no dedup. The web Leaderboards screen offers a Season / All-time
  toggle; the all-time view shows no season-reset line.

Product decisions currently in force:

- Surge and Trade are golf-time modes: lower is better.
- Wrong timed answers add `+2.0s` and leave the prompt live until solved.
- Practice defaults to the pip keypad and also offers 4-button choices.
- Evolutions and Hero flags are flavor only; the answer is always base elixir.
- Daily Ladder is not shipped and should not be built without a fresh approval.

---

## 5. Shared Game Systems

Important shared modules:

- `apps/web/src/lib/storage.ts` - all current localStorage reads/writes.
- `apps/web/src/lib/game-challenge-content.ts` - resolves signed server
  challenges into playable card content (card selection is server-owned).
- `apps/web/src/lib/choices.ts` - adjacent elixir distractors.
- `apps/web/src/lib/preload.ts` - image preloading for timed runs.
- `apps/web/src/lib/run-loop.ts` - countdown, timeout clearing, and elapsed-time helpers.
- `apps/web/src/lib/card-rendering.ts` - shared card rarity labels, modifier classes, and
  Clash-style name tone mapping.
- `apps/web/src/lib/insights.ts` - Practice and Surge coaching insights.
- `apps/web/src/lib/mode-insights.ts` - mode-specific Trade summary lines.
- `apps/web/src/lib/elixir-lines.ts` - static host lines; no LLM at runtime.
- `apps/web/src/lib/analytics.ts` - Tinylytics custom event bridge and local funnel mirror.

Player XP and the per-player arena:

- **XP is an activity score, not a skill score.** `services/api/src/xp.ts`
  `runXp` awards one point per question attempted in a run — right or wrong —
  with a floor of 1. It rewards practice volume so a longer session moves the
  arena more than a quick one and a beginner always progresses. Skill lives
  entirely on the leaderboard (speed). Practice earns XP too (it is unranked,
  not inconsequential).
- XP is added to the `PLAYER#/PROFILE` item inside the same `completeRun`
  transaction as the player and global counts, and is returned on `GET /me`,
  `/runs/complete`, and leaderboard rows. Rejected runs earn nothing.
- The 28 arena tiers in `apps/web/src/data/starRanks.ts` are thresholded on
  lifetime XP (Goblin Stadium at 0 through Summit of Heroes at 68,000, ~5,000
  games), shown in the nav player block and the profile. The arena only climbs.
  The former games-derived "Level" is retired.

Global games counter (site social proof):

- `GET /stats` returns `trophyRoadGames`: a one-time launch seed of 592 that
  advances once per server-accepted completed run, incremented in the same
  transaction as the player count, run history, and leaderboard entry. Failed,
  rejected, and duplicate submissions do not advance it. It is surfaced on Home
  as "games played across Drop" and is unrelated to per-player XP.
- Tinylytics page views and events are analytics only. Clan Wars seasons reset
  leaderboards, not lifetime XP or the global games counter.

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

## 6. Current Browser Storage

All currently implemented persistence goes through
`apps/web/src/lib/storage.ts`.

```text
elixirdrop:profile       -> { createdAt, nickname?, totalSessions }
elixirdrop:cardStats     -> { [id]: { seen, correct, missStreak, lastSeen, avgMs? } }
elixirdrop:records       -> { surgeBest, surgeBestPace, longestStreak, bestAccuracy,
                              survivalBest, tradeBest }
elixirdrop:seasonRecords -> { seasonId, records } (season-scoped bests; a new
                             server season id resets the slate)
elixirdrop:funnel        -> { recruitShown, recruitJoin, recruitDiscord, shares }
elixirdrop:settings      -> { inputStyle, sound, reducedMotion? }
```

Authoritative learning telemetry is server-side: accepted completions in the
card-recall modes fold per-card outcomes (derived from the validated
transcript) into a per-player CARDSTATS item. GET /me retains a learning
summary (weak cards + per-cost accuracy) for possible future coaching, and
account deletion sweeps it. Learning telemetry does not affect challenge card
selection. The localStorage copy is a display cache only.

Local card-learning signals and personal browser records remain local. Every
mode also obtains a short-lived, single-use signed run from the API. The server
owns the challenge, validates the submitted transcript, and recomputes the
score. Authenticated completions become immutable run history and leaderboard
input.

Guest play is the signed-out path. `/runs/start` and `/runs/complete` both make
the session **optional**: with no bearer token, `/runs/start` deals the same
server-signed challenge under the reserved `guest` owner sentinel (which cannot
collide with a real base64url-SHA-256 sub), marks the run `guest: true`, always
unranked, and signs the run token `guest: true`. On completion a guest run is
still scored (validate + recompute) but the integrity gate and every recording
step are skipped — no `completeRun`, XP, leaderboard, all-time best, Discord, or
learning stats — and the run row is left to TTL-expire. The guest completion
returns a distinct minimal shape `{ accepted: true, guest: true, mode, score,
season }`. A `/runs/complete` carrying a non-guest run token still requires a
session that owns the run.

Anti-cheat separates invalid input from suspicious valid play. A transcript that
fails deterministic scoring remains rejected with `400` and is not recorded.
When `services/api/src/integrity.ts` finds a structurally valid ranked run
implausible (an out-of-range score, timed-mode score floor, or continuous-mode
completion-rate ceiling), completion atomically records the run **and** creates
a `review`/`hidden` decision before the score can appear publicly. The response
includes `underReview: true`; Discord promotion is suppressed. The Fair Play
Referee can confirm the hide or approve a false positive by writing a new,
audited visible decision. Practice is unranked and only feeds XP, so it is
checked for score range alone. Guest runs skip the integrity gate entirely
because they are never recorded. Completion and the public read endpoints are
also IP rate-limited (guests included, since the per-IP
`run-start`/`run-complete` limits run before any auth branch; `/runs/complete`
at 300/hour; the shared
`reads` scope over `/leaderboards`, `/stats`, and `/seasons` at 1200/hour).

Authenticated public identity is centered on one favorite card:

- The player chooses a card from the canonical committed snapshot; its ID is
  stored as `favoriteCardId` and its artwork becomes the profile image.
- `POST /me/name-options` accepts that card ID and uses Claude Haiku to return
  playful public names inspired by its title, community nicknames, mechanics,
  artwork, and character, plus a short-lived signed choice token. Names do not
  need to contain the exact card title.
- The token binds the player, favorite card, and exact name choices. `PATCH /me`
  accepts the card and selected name together and persists them atomically.
- Changing a favorite card requires choosing a new card-derived name in the
  same flow. Existing profiles without a favorite card remain readable and use
  the Elixir avatar until the player chooses one.
- Clash Royale player tags are separate and unverified. Saving or reading a
  stale tag queues a refresh; snapshots are fresh for six hours and shared by
  tag. Drop shows CR name, clan, gameplay-derived Years Played account age, and
  the owned-card _count_. Experience, arena, trophies, wins, card levels, and
  the card collection grid are excluded — the grid has no use in Drop, only the
  count is shown. Drop's own arena (per-player, from Player XP) is native and
  unrelated to CR arenas.
- Every game uses the complete canonical card catalog; ranked runs place on the
  seasonal leaderboard while Practice is unranked. The attached collection
  remains loaded and stored, but is not used for challenge generation and is not
  rendered. Historical unranked runs remain readable for compatibility.

---

## 7. Analytics And Recruiting

Tinylytics property:

- Site ID: `JjqvUeyEnrPM1f_iXrbU`
- Integer ID: `3445`

Analytics are best-effort and must never block gameplay.

Tracked events include:
`game.start`, `mode.practice`, `mode.surge`, `mode.higherlower`, `mode.trade`,
`mode.survival`, `surge.complete`, `trade.complete`, `survival.win`,
`record.new`, `recruit.shown`, `recruit.join`, `recruit.discord`,
`result.share`, `egg.screensaver`.

Recruitment remains moment-based:

- Trigger on strong summaries or new records, not load-time modals.
- Keep the persistent footer quiet.
- Lead with Discord when the clan is full.

---

## 8. Design And Assets

Elixir Drop vendors its own visual layer:

- `apps/web/src/styles.css` contains the local tokens and components.
- `apps/web/public/assets/` contains Elixir art, emoji states, arena images, fonts, OG
  image, favicon, and star asset.
- Card art is mirrored same-origin under `apps/web/public/cards/` (refresh
  always runs with `MIRROR_IMAGES=true`). The "Elixir Rain" screensaver
  Easter egg (see GAMES.md) draws this art as WebGL textures via pixi.js;
  activation lives in `apps/web/src/lib/screensaver.ts`, the overlay in
  `apps/web/src/components/Screensaver.tsx`.
- Player avatars use the canonical card art through a circular CSS crop. Default
  focal coordinates and rare per-card adjustments live in
  `apps/web/src/data/avatar-crops.ts`; no derivative avatar images are shipped.
- In development, `#/avatar-audit` renders all canonical cards at the real
  header, leaderboard, and profile sizes for crop review. The route is excluded
  from production builds.
- `docs/clash-royale-screenshots/` contains local visual references for card
  frames, elixir badges, and rarity-colored text treatment.
- `docs/card-rendering.md` documents the current card-rendering findings and the
  shared helper surface: `apps/web/src/components/CardChrome.tsx`,
  `apps/web/src/lib/card-rendering.ts`, and the `cr-*` CSS classes.

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
- Oxlint
- Stylelint
- TypeScript typecheck
- Knip
- Vitest unit tests
- Chromium Playwright e2e tests
- Production build

GitHub Actions runs the same verification path on push to `main`, after
installing Chromium with Playwright. The Pages artifact is uploaded from
`apps/web/dist/` only after verification passes.

Current e2e coverage includes:

- Route accessibility smoke checks (launch five).
- Card art fallback.
- Trade exchange hints.
- Settings persistence.
- Active timed states using low chrome with visible controls.

---

## 10. Operations And Architecture

This Mac owns the allowlisted CR API token and runs both CR consumers:

- Keep the root `.env` local and mode `0600`; it holds the CR token plus separate
  deployment and queue-only bridge credentials.
- Keep the launchd bridge loaded and review
  `~/Library/Logs/elixir-drop-cr-bridge.log` when a refresh is delayed.
- Run `apps/web/scripts/refresh-cards.mjs` manually after known Supercell updates
  or on a conservative cron.
- Queue retries end in dedicated request/result dead-letter queues rather than
  silently dropping work.

The implemented API, bridge, and deployment model are documented in their
workspace READMEs.

---

## 11. Referee Evidence And Retention

Drop durably persists **referee-grade evidence** so the external Fair Play
Referee (`AGENT-TEAM/fair-play-referee.md`) can review leaderboard integrity
against exact server-side facts and make reversible run-visibility decisions.
The agent owns its judgment; Drop stores the audited decision overlay and
reconciles it into public leaderboards.

**What is captured.** On `/runs/complete`, best-effort (never failing or rolling
back a recorded run), one evidence item is written for:

- a **recorded ranked** run, whether accepted immediately or automatically
  quarantined for review, and
- a **scorer-rejected signed-in** run for which no valid score could be
  produced.

Practice (`ranked:false`) and guest runs write **no** evidence.

**Where it lives.** `PLAYER#{sub}/EVIDENCE#{completedAt}#{runId}` in the main
table, co-located with the player's partition so account deletion
(`DELETE /me`) sweeps it for free. Each item carries: `runId`, `mode`,
`seasonId`, `runType` (`ranked`/`rejected`), `integrityOutcome` (`accepted`, an
automatic-review reason, or a scorer-reject reason), server-recomputed `score`
(+ Survival `tiebreakMs`), the full
signed `challenge`, the full raw `transcript`, `startedAt`/`completedAt`/
`wallElapsedMs`, a `scoringVersion` (`{ web: build sha, rules: SCORING_RULES_VERSION }`),
the normalized unverified `playerTag`, a `schemaVersion`, and an `expiresAt` TTL
(default **180 days** — active season plus the human review window). It contains
**no email**; the pseudonymous `playerId` is what the read scripts emit.

**Retention.** Evidence past its TTL returns `insufficient_evidence` for old
all-time entries (the referee rubric handles this); lengthen the TTL
(`EVIDENCE_TTL_SECONDS`) for deeper all-time review.

### Connection correlation without storing IPs

The referee must be able to show that _"games from different players share one
source"_ **without Drop storing the actual IP or user-agent**.

- On start **and** complete, Drop reads `sourceIp` / `user-agent`, immediately
  derives peppered HMAC hashes, and **discards the raw values** — they are never
  written anywhere. Capturing both start and complete lets the referee treat a
  start/complete mismatch as its own signal.
- `correlation` holds: `ipHash` (`HMAC-SHA256(TELEMETRY_PEPPER, normalizedIp)`,
  same-address correlation), `ipSubnetHash` (HMAC of the /24 IPv4 or /64 IPv6
  prefix, same-network correlation), `uaHash` (exact-client), and a coarse
  `uaFamily` (e.g. `Chrome/macOS`). Same source ⇒ same hash; the hash is **not
  reversible** to an IP without the pepper.
- **`TELEMETRY_PEPPER`** is a required server secret, guarded like
  `SESSION_SECRET`: Lambda env only, **never** in the read scripts, the
  referee role, CI, or the browser. A stable pepper enables long-window
  correlation (default); rotating it strengthens privacy but shortens the
  correlation window. Anyone holding the pepper _and_ table read could brute the
  ~2³² IPv4 space, which is exactly why the pepper is Lambda-only and the
  referee only ever sees opaque tokens.

### Referee surface

The referee operates via purpose-built scripts in `AGENT-TEAM/scripts/`
(documented in that directory's README), run under the bounded
`RefereeReadRole` (physical name retained for compatibility). It can read the
game table and write only `REFEREE#` decision partitions; it cannot edit runs,
scores, evidence, players, XP, or leaderboard rows and has no secret access. A sparse
`GSI2` (`GSI2PK="TAGGED"`, `GSI2SK="{normalizedPlayerTag}#{playerId}"` on tagged
PROFILE items) backs player-tag clustering, and `runId` on the all-time item
resolves an all-time board entry to its earning run. The scripts sanitize on the
way out (pseudonymous `playerId`, opaque hashes, normalized tag — never `sub`,
email, a raw IP, or the pepper) and **fail closed** on missing or incomplete
evidence. Each current decision records disposition, `visible`/`hidden`, a
private reason, evidence digest, and timestamp, with immutable decision history.
Season and all-time reads omit hidden runs; if a hidden run was a player's best,
the board uses that player's next-best visible run. Approval restores the run at
its correct rank.

---

_Unofficial fan project. Card data, names, and artwork © Supercell, used under
Supercell's Fan Content Policy. Not endorsed by Supercell._
