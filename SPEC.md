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
- **Secondary goal:** be a quiet, persistent front door to POAP KINGS — a footer
  credit and a Discord link, not a triggered pitch.
- **Host / mascot:** none. The Elixir mascot emote set was removed from the app;
  the remaining brand marks are the Drop app icon (`assets/icon/`) and the
  text-composited social card (`assets/og-image.png`, rebuilt by `npm run og`
  over the text-safe `assets/share/og-default.png` backdrop).

The public website remains a static GitHub Pages app, but it now uses a separate
Lambda API for email magic-link accounts, profiles, signed runs, progression,
global game totals, and seasonal leaderboards. The site and leaderboards remain
public. Anyone can play every mode **without an account as a guest**: a guest run
is dealt the same server-signed challenge and scored the same way, but nothing is
recorded (no leaderboard, no all-time, no XP, no history, no Discord) — the
summary nudges the visitor to sign in before the next game so future scores can
be recorded. An email-authenticated player session unlocks recording and
ranking. Dynamic Clash Royale player enrichment and the global Clan Wars clock
run asynchronously through the fixed-IP bridge.

The only outbound ties are ordinary links:

- POAP KINGS site: `https://poapkings.com`
- Clan invite:
  `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
- Discord: `https://discord.gg/SdvKfJW5kA`
- General contact, privacy requests, and Fair Play disputes:
  `drop@poapkings.com`
- Transactional player-mail sender (including magic links):
  `elixir@poapkings.com`
- Supercell / fan-policy attribution links

Hard product constraints:

- Do not call the Clash Royale API from the browser, CI, or Lambda.
- Only the fixed-IP bridge may call the Clash Royale API at runtime.
- Do not put the CR API token in client code, Lambda, CI, or committed files.
- Do not add curated deck definitions, archetype lists, or game modes that depend
  on authentic deck construction; new game modes work from the committed facts in
  `packages/game-data/cards.json`. (`GAMES.md` holds the rationale.)

---

## 2. Repository And Runtime Stack

The repository uses npm workspaces:

| Workspace / directory    | Responsibility                               | Status      |
| ------------------------ | -------------------------------------------- | ----------- |
| `apps/web`               | Public Preact game                           | Implemented |
| `apps/admin`             | Private tailnet-only Control Room UI         | Implemented |
| `services/api`           | TypeScript Lambda player and game API        | Implemented |
| `services/admin`         | Loopback Control Room and referee adapter    | Implemented |
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
| Persistence | `localStorage`; learning progress through `apps/web/src/lib/storage.ts` (§6) |
| Analytics   | Tinylytics, Elixir Drop's own property                      |
| Hosting     | GitHub Pages, custom domain `drop.poapkings.com`            |
| Deployment  | Cancelable `Validate Main` → serialized, path-aware API/Pages promotion |

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
- Read art from `iconUrls.medium` (plus `evolutionMedium` / `heroMedium`), then —
  because the refresh always runs with `MIRROR_IMAGES=true` — download it and
  rewrite `icon` to the same-origin `/cards/{id}.png` path. A CDN URL only
  survives in the snapshot if someone runs the refresh without that flag, which
  is exactly the mistake the refresh model above guards against.

The API reference under `docs/cr-agent-api-docs/` is the source material for
these assumptions.

---

## 4. Shipped Modes

`GAMES.md` is authoritative for mode mechanics, backlog, and retired ideas. The
app has six playable modes, routed from `apps/web/src/lib/game-routes.ts`:

| Mode           | Route            | Score / record                              |
| -------------- | ---------------- | ------------------------------------------- |
| Surge          | `#/surge`        | `surgeBest`, lowest 15-card sprint time     |
| Practice       | `#/practice`     | section hub; drills are unranked/unscored   |
| Higher / Lower | `#/higher-lower` | `higherLowerContinuousBest`, total correct |
| Trade          | `#/trade`        | `tradeLadderBest`, lowest 10-exchange time  |
| Survival       | `#/survival`     | `survivalBest`, longest sudden-death streak |
| Rain           | `#/rain`         | `rainBest`, most cards cleared              |

Survival, Rain, Higher / Lower, and Trade each carry a **board epoch**
(`BOARD_EPOCH` in `services/api/src/games.ts`, mirrored in
`AGENT-TEAM/scripts/_referee-lib.mjs`): a material rules change restarts the
board rather than deleting data, and old rows are orphaned. Rain is on `r3`
(it gained tiebreaks its old rows cannot carry), Higher / Lower is on `r3`
(its clock now tightens continuously instead of flattening at 2s), and Survival
and Trade are on `r2`. A mode whose scoring shape or attainable distribution
changes usually renames its local record key in the same move (`longestStreak`
→ `higherLowerBest` → `higherLowerContinuousBest`, `tradeBest` →
`tradeLadderBest`), so an on-device best from retired rules orphans the same way
the board did instead of standing as an unbeatable target.

Trade's run length is the length of `TRADE_LADDER` in `packages/contracts`
(`TRADE_ROUNDS`), the fixed board ladder the server deals and the browser plays;
neither side carries its own exchange count.

Equal scores are separated by **ordered ascending tiebreaks**
(`MODE_TIEBREAKS`), each emitted as a 9-digit segment of the sort key in ranking
order: Survival ranks by cumulative time; Higher / Lower ranks by fewest lives
lost, then cumulative time; Rain ranks by fewest wrong guesses, then lowest
average clear latency. The values ride along on the run row under their own
attribute names (`livesLost`, `timeMs`, `wrongGuesses`, `avgLatencyMs`) so the
GSI1SK fallback can rebuild the
exact key. **Every row in one partition must emit the same number of segments** —
mixing shapes compares a 9-digit number against an ISO timestamp at the same
offset — which is why a mode gaining a second tiebreak also takes a new epoch.
A tiebreak value is always **derived from the validated transcript**, never
reported by the client: Rain's average clear latency, for instance, is each
clear's `atMs` minus the earliest moment that tile could have spawned, so the
number that has to clear the integrity floor is the same number that ranks the
tie and there is nothing extra to forge.

Practice runs are created `ranked: false` server-side: they record to history
but never write a leaderboard entry, earn no Player XP, and Practice has no
leaderboard tab and no record key in `RECORD_KEYS` (its `GameMode` is excluded
from the type, so a Practice best is unrepresentable rather than merely
discouraged). Practice is the only active drill. Ledger is deactivated in the
browser: discovery omits it and `/practice/ledger` redirects to active Practice.
Its `practiceKind`, transcript validation, learning aggregates, stored progress,
and implementation remain for historical and rolling compatibility without
adding another `GameMode`. The active `practiceKind: costs` transcript validates
answer-card set membership because the client adaptively reorders the pool.
Retained Ledger validation checks every 2–6-play sequence against that same pool
and recomputes Red spend minus Blue spend from canonical costs. Those
relaxations are safe only because nothing about Practice is competitive.
`GAMES.md` owns the mechanics.

Each ranked mode has three boards, selected by the `scope` query param on
`GET /leaderboards` (`season`, the default, `all-time`, or `clan`):

- **Season** is the existing per-season board: every positive-scoring completed
  ranked run writes a history row into GSI1 under
  `LEADERBOARD#{seasonId}#{mode}`, and a read dedups to each player's best run in
  that season.
- **All-time** ranks a player's best-ever score per mode across all seasons. It
  stores exactly one best item per player per ranked mode at
  `pk = PLAYER#{sub}`, `sk = ALLTIME#{mode}`, indexed into the same GSI1 under
  `LEADERBOARD#ALLTIME#{mode}` with the identical sort-key encoding (better
  score/tiebreak → smaller key). A completion updates it best-effort after
  `completeRun`. Versioned modes reject runs from retired board epochs; the
  conditional write resets when the stored GSI partition belongs to a retired
  epoch, otherwise only a better current-board sort key wins. A run that is not
  a new best is silently skipped, so the recorded run never rolls back. Because
  there is one item per player, the read needs no dedup. The web Leaderboards
  screen offers a Season / All-time / Clan toggle; the all-time view shows no
  season-reset line.
- **Clan** is an authenticated view of that same all-time partition, filtered
  by each Drop player's latest stored Clash Royale clan snapshot and reranked
  within the signed-in player's current clan. The bounded read may page beyond
  the global top results so a clanmate is not omitted merely for ranking lower
  globally. Lambda never refreshes CR data on this route; only the bridge owns
  live Clash Royale ingress.

Leaderboard eligibility is stricter than run acceptance: a ranked completion
must score **above zero** to receive a seasonal or all-time index projection.
Zero-score attempts remain immutable history and still earn activity XP, but
they have not demonstrated leaderboard skill. Reads reject legacy zero-score
projections defensively.

Product decisions currently in force:

- Surge and Trade are golf-time modes: lower is better.
- Wrong timed answers add `+2.0s` and leave the prompt live until solved.
- Practice defaults to the pip keypad and also offers 4-button choices. The
  keypad has one key per cost the catalog actually has (currently 1–9), always
  dealt as two full-width rows — 1–5 over 6–9 — for roughly double the tap-target
  width, everywhere the pip keypad renders (Surge, Practice, Survival, Rain) —
  never Trade or Ledger, which share the RED/BLUE exchange board. (The old single
  row and the opt-in Speedrun keyboard setting were removed in the 2026 refresh:
  two rows is the only keypad.)
- Active Practice is a learning loop, not a finite round: no progress bar and no
  share action. It times the first response invisibly, separates requested assistance
  from recall, offers voluntary help after seven idle seconds, gives keypad
  recall one anchored higher/lower retry, then reveals the exact answer. Missed
  cards return through the short-term spaced-review queue documented in
  `GAMES.md`.
- Deactivated Ledger code adapts sequences from two guided plays to six tracked
  plays. It uses Practice fluency only to decide which faded-stage costs remain visible;
  Ledger outcomes never mutate those per-card stats. Requested `Show ledger`
  help is stored separately from unassisted balance reads.
- Evolutions and Hero flags are flavor only; the answer is always base elixir.
- Daily Ladder is not shipped and should not be built without a fresh approval.

---

## 5. Shared Game Systems

Important shared modules:

- `apps/web/src/lib/storage.ts` - the learning-progress storage boundary (§6).
- `apps/web/src/lib/game-challenge-content.ts` - resolves signed server
  challenges into playable card content (card selection is server-owned).
- `apps/web/src/lib/choices.ts` - adjacent elixir distractors on a randomly
  offset window (Practice's 4-choice input only).
- `apps/web/src/lib/practice-deal.ts` - Practice's weakness-weighted card draw.
- `apps/web/src/lib/practice-review.ts` - Practice's guaranteed short-term
  retry and confirmation queue.
- `apps/web/src/lib/ledger.ts` - Ledger stage graduation, answerable sequence
  dealing, fluent-card visibility, and Blue-perspective balance labels.
- `apps/web/src/lib/preload.ts` - image preloading for timed runs.
- `apps/web/src/lib/run-loop.ts` - countdown, timeout clearing, and elapsed-time helpers.
- `apps/web/src/lib/card-rendering.ts` - shared card rarity labels, modifier classes, and
  Clash-style name tone mapping.
- `apps/web/src/lib/insights.ts` - Practice and Surge coaching insights.
- `apps/web/src/lib/mode-insights.ts` - mode-specific Trade summary lines.
- `apps/web/src/lib/signatures.ts` - the summary chart builders. The five ranked
  modes share one grammar (seconds bars, a per-bar seconds reference tick, a red
  bar whose cost the mode names); the two drills are exempt. See `GAMES.md` →
  "The summary signature chart".
- `apps/web/src/components/summary/SignaturePanel.tsx` - the ranked chart, which
  owns the mandatory unit / reference / scale / finding and the 30-bar bucketing.
- `apps/web/src/components/summary/DrillPanel.tsx` - the drills' plain bar
  series, deliberately outside that grammar.
- `apps/web/src/components/shell/DesktopWallpaper.tsx` - Falling Cards as the
  letterbox margin's wallpaper (CSS, not the Pixi scene: this sits behind the app
  for as long as the tab is open).
- `apps/web/src/components/RankedTouchGate.tsx` - the touch-only ranked gate and
  its QR bridge. `qrcode-generator` is imported lazily HERE and nowhere else, so
  the encoder never rides in the chunk every phone player downloads.
- `services/api/src/shares.ts` - share-token minting, the look-alike-free
  alphabet, the per-token open credit cap, and the bounds on the run shape a
  stranger's browser renders.
- `services/api/src/routes/shares.ts` - `POST /runs/{runId}/share` and
  `GET /shares/{token}`, including the peppered per-visitor dedupe and the rule
  that the sharer's own device earns nothing.
- `apps/web/src/screens/SharedRun.tsx` - what `#/r/<token>` opens.
- `apps/web/src/lib/analytics.ts` - Tinylytics custom event bridge.

Player XP and the per-player arena:

- **XP is an activity score, not a skill score.** `services/api/src/xp.ts`
  `runXp` awards one point per question attempted in a run — right or wrong —
  with a floor of 1. It rewards practice volume so a longer session moves the
  arena more than a quick one and a beginner always progresses. Skill lives
  entirely on the leaderboard (speed). **Practice earns zero XP** — the exclusion
  is applied at the `routes/runs-complete.ts` call site, not inside `runXp` —
  because an endless mode paying per question would make the arena farmable.
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
  transaction as the player count, run history, and any eligible leaderboard
  entry. Failed, rejected, and duplicate submissions do not advance it. It is
  surfaced on Home as "games played across Drop" and is unrelated to
  per-player XP.
- Tinylytics page views and events are analytics only. Clan Wars seasons reset
  leaderboards, not lifetime XP or the global games counter.

Timing rules:

- Use `performance.now()` for elapsed-time math.
- Ranked clients attach one coarse input observation per scored tap or key
  action: round/value, prompt-enabled time, input time, broad input kind, and
  the browser's `isTrusted` bit. They never attach coordinates, pressure,
  pointer identity, or key codes. The API verifies that this sidecar matches the
  scored transcript before summarizing it into referee evidence.
- Competitive active time is prompt-enabled to answer, so forced correct/wrong
  reveal beats and card-transition waits do not count as player response time.
  Legacy transcripts retain an inferred active-time summary for context, but
  only current observed timing can trigger the new timing holds.
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

**This section is the canonical inventory of every browser-storage key.** Every
key uses the `elixirdrop:` prefix. `apps/web/src/lib/storage.ts` is the boundary
for **learning progress** — game code must never touch those keys directly — but
it is not the only owner: four other modules own their own narrow state, and
that is deliberate, not drift.

Learning progress, owned by `lib/storage.ts` (`localStorage`):

```text
elixirdrop:profile       -> { createdAt, nickname?, totalSessions }
elixirdrop:cardStats     -> { [id]: { seen, correct, missStreak, lastSeen,
                                      recallSeen?, recallCorrect?, assistedSeen?,
                                      assistedCorrect?, avgMs?, latencySamples? } }
elixirdrop:ledgerStats   -> { checks, correct, assisted, unassistedChecks,
                              unassistedCorrect, longestSequence, byStage,
                              updatedAt? }
elixirdrop:records       -> { surgeBest, surgeBestPace, higherLowerContinuousBest,
                              survivalBest, tradeLadderBest, rainBest }
                            (no Practice key — Practice keeps no record)
elixirdrop:seasonRecords -> { seasonId, records } (season-scoped bests; a new
                             server season id resets the slate)
elixirdrop:settings      -> { inputStyle, sound, reducedMotion?, enhancedEffects? }
```

Session, install, and player-nudge state, owned by their own modules:

```text
elixirdrop:session:v1               -> lib/account.ts     localStorage   { token, expiresAt }
elixirdrop:installDismissed         -> lib/pwa-install.ts localStorage   Home banner dismissed
elixirdrop:installSessionCount      -> lib/pwa-install.ts localStorage   distinct browser
                                       sessions (install is suggested on the third)
elixirdrop:installSessionCounted    -> lib/pwa-install.ts sessionStorage per-session marker so
                                       one session counts once
```

(The `elixirdrop:playerTagNudge` key was retired with the PlayerTagNudge modal in
the 2026 refresh: the missing-tag prompt is now a card at the top of the Updates
scope, derived from account state, so it needs no per-device timestamp.)

The one-time release-notice overlay (and its `elixirdrop:releaseSeen` key) was retired
in the 2026 refresh: named releases now appear in the **Updates** scope on the You page,
and unread state is a single server-owned `lastOpenedUpdates` timestamp on the account —
account-level and deliberately not per-device, so it never needs a browser key.

The `records` shape is `Records` in `apps/web/src/types.ts`; the settings shape is
`Settings` there.

Authoritative learning telemetry is server-side: accepted completions in the
card-recall modes fold per-card outcomes (derived from the validated
transcript) into a per-player CARDSTATS item. Practice transcripts additionally
carry bounded first-response milliseconds and whether recognition help was
used; the aggregate keeps assisted recognition separate and averages only
unassisted recall latency. Legacy rows fall back to their lifetime counters.
Ledger completions instead fold accuracy, assistance, stage, and sequence length
into a per-player LEDGERSTATS item; they contribute no CARDSTATS results. GET
`/me` retains both summaries and account deletion sweeps both player-partition
items. Learning telemetry does not affect official challenge generation;
Practice's device-local deals may use their local copies. Immutable run history
also retains the validated `answerCount` (not the raw transcript), so Practice
volume can be rebuilt without storing a second copy of a player's guesses;
Ledger stores zero there to keep Reps and Clean Sweep isolated.

Badge ladders are server-owned on the same contract. One `PLAYER#{sub}/BADGES`
item holds the monotonic counters, per-rung `time` run counts, the distinct-mode
and distinct-card sets, distinct played-day and same-day run bookkeeping, and an ISO stamp per cleared
rung. It is written best-effort *after* `completeRun` succeeds — never inside its
transaction — so a badge failure leaves the run recorded, and account deletion
sweeps it with the rest of the player partition. `GET /me` returns a `badges`
summary (`{ badges: BadgeState[], backfilled?: true }`), rebuilding the counters
from run history plus CARDSTATS the first time a player is read; new history
rows retain the board epoch that dealt them so a mode-skill badge cannot mix
retired, incomparable formats. Daily Drop advances once on each recorded local
calendar day in any mode, including Practice; days need not be consecutive and
multiple runs on one day count once. Guest and offline play remain outside every
badge. Legacy history has no timezone, so a rebuild uses its UTC completion date
for those rows and local days for live completions. Counter version 6 rebuilds
that distinct-day count from history, settles the 2026-08-16 play-test ladders,
and preserves forward-only state such as Podium, Reps, Clean Sweep, and hidden
badges. Counter version 7 re-settles the August 20 prismatic targets and rebuilds
Sharp Trade's per-rung counts for its new 40-second ceiling. `backfilled`
tells the browser to show one summary instead of queueing celebrations.
`GET /players/{playerId}` returns the same badge summary for the read-only public
profile, where only earned medallions are shown. Its identity projection also
includes the unverified Clash player tag plus CR name and clan when the shared
snapshot has them; account age and collection context remain owner-only.
Missing or stale counters take
the same history-backed rebuild path, so another player never sees an empty wall
merely because the owner has not opened Profile since badges shipped.
`/runs/complete` returns `earnedBadges`, the rungs that run cleared, plus the
current badge summary so the in-memory Profile updates without another request.
Awarding is a pure function of the counters
(`services/api/src/badges.ts`), badges award no XP, and no valid achievement is
ever revoked; a versioned correction may remove a retired-board result that
never met the badge's stated requirement, and a final referee exclusion removes
that ineligible run from the derived award projection. Every ranked-run referee
decision appends a player-scoped badge invalidation marker and increments an
atomic revision under `REFEREE#`. The next owner or public profile read rebuilds history-backed counters without final
excluded runs, subtracts their exact retained card outcomes, removes
run-timestamped forward-only achievements, and preserves canonical runs, XP,
learning history, and evidence. A later audited restoration invalidates the bag
again and restores the run's contributions, including archived forward-only
badge facts. Pending holds do not revoke badges. The ladder table and the 28 arena XP thresholds both live in
`packages/contracts` because the browser and the Lambda cannot import each other.

Profile history has two deliberately different reads. `GET /me` keeps the
20-row recent feed used across the app; `GET /me/seasons` walks the player's
complete `RUN#` range and filters retired modes, but its **response is bounded**:
`index` lists every season the player has runs in with a game count (one row
each), while `seasons` carries the runs for a single season. `season=<id>` picks
one, `season=all` is an explicit opt-in to the whole career, and omitting it
returns the most recent season. Each index row carries `crSeasonId` — the Clash
Royale season number players recognise. Nothing stores a past season's number
(only the live war clock holds both ids, and it is overwritten each rollover),
so it is derived: Clan Wars seasons are monthly and sequential, so a season's
number is the current one offset by the months between them, and an id carrying
an explicit `-NN` suffix states its own. `crSeasonIdFor` returns undefined
rather than a guess when no clock can anchor it, and the UI falls back to the
raw id. `placements=1` additionally returns each run's board rank, but only for
the run that actually holds the player's position for its mode — one leaderboard
read per ranked mode played, so it is opt-in and never spans `season=all`. `mode` and `status` narrow further; `status`
takes `pending`, `reviewed`, `excluded`, or `unreviewed` — the last of which is
the absence of a decision, which is what most runs are. A recent-feed cap must
never be used as a season total.

The bound is the point: players are into the hundreds of games, and the old
read shipped every one of them to render a single month. The You page's single
**Your games** panel (which replaced the split recent-games list, Seasons
section, and season modal) loads the current season, then fetches one older
season per press of its paging control. Its three status count tiles double as
the status filter, so counts are computed in the browser over the loaded,
status-unfiltered rows; season and mode scope them.

The private profile also records `lastLoginAt` when a magic link is successfully
redeemed. It is separate from `updatedAt` (profile/game mutation) and from run
activity, so Drop Control never presents a guess as a login time. Profiles that
predate the field show no recorded login until their next redemption.

### Sharing a run

Sharing is two things travelling together: an image, which is what gets looked
at, and a link, which is what gets counted.

**The image** is composited in the browser (`apps/web/src/lib/share-card.ts`): a
1080×1350 canvas over `assets/share/share-backdrop.png` with the mode emblem,
score, the run's own signature series (cost-band squares when a mode has no
series), arena and sticker drawn on top. Every source is same-origin so the
canvas never taints. A share card drops the GAME's half of the summary chart —
the window, the fall time and the "seconds to answer" framing explain a run to
the person who made it and mean nothing to a stranger. Only the player's own
series travels, and `refs` carries a reference only when it is the player's own
previous best (today: Surge).

**The link** is a minted permalink. `POST /runs/{runId}/share` returns a
six-character token from an alphabet with no look-alike glyphs (a player may read
one aloud), and one token is minted per SHARE ACTION — sharing the same run twice
mints two tokens, which is what makes reach countable per share rather than per
run. `GET /shares/{token}` resolves it. The address is `#/r/<token>`: the site is
GitHub Pages with hash routing, so there is no server to render `/r/<token>` or a
per-run unfurl preview, and a pasted link unfurls with the generic Drop card.

**What the browser does.** `components/ShareLine.tsx` mints, renders, and calls
`navigator.share` with the image as a `File`, the URL and one line of text — the
native sheet, always, with no Drop-branded picker in between. Without a native
sheet the same payload is unbundled into copy-the-link and save-the-image; that
is not a degraded dialog but the same two things spelled out. If minting fails
the button says so rather than sharing a link to nowhere.

**A not-recorded run has no share control at all.** Offline, guest, and Practice
runs have no server record, so no permalink can exist. `Summary` renders nothing
(absent, not disabled — a disabled button invites a tap and then has to explain
itself) and the mint endpoint refuses independently rather than trusting the
button. Practice is excluded for a second reason too: session length and accuracy
in an endless drill are not comparable results.

**What the link opens** (`apps/web/src/screens/SharedRun.tsx`) is the RUN, with
the score as the button — never the home page. Nothing travels that the public
profile does not already show: score, mode, name, arena.

**Counting opens.** A distinct visitor opening `/shares/{token}` is credited
once. The visitor key is a peppered one-way HMAC of the request scoped to that
token, so Drop counts opens per token and never learns who opened; no raw IP or
user-agent is stored, which is the same rule referee evidence works under. The
sharer's own device earns nothing, and credit stops at 25 per token so one lucky
link cannot clear a ladder. The counter is written best-effort — a link opens
whether or not the count lands. Privacy and Fair Play both state this, which was
the stated condition for any share badge shipping. The badge itself is not
implemented; the counter it will read is.

**Deletion.** The share item lives outside `PLAYER#` so a stranger can resolve it
by token alone, so a `PLAYER#{sub}/SHARE#{token}` pointer is written in the same
transaction; account deletion follows the pointer and sweeps the share and its
per-visitor open markers with everything else.

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

Offline play is a separate, explicitly unrecorded path. When
`navigator.onLine === false` or the API boundary has classified a network error,
timeout, or 5xx response as unavailable, the browser does not make another
`/runs/start` call: it creates a tokenless `offline:{mode}:…` run from the same
pure challenge generator used by the API. `/runs/complete` is never called, no
transcript or score is queued, and reconnecting cannot promote the run. A failed
start request may establish that offline state and immediately fall back to a
local run. The summary keeps the local result visible
but does not write personal or season records, recent history, XP, badges,
leaderboard entries, learning telemetry, or the global game count. Device-local
card stats may still update as an adaptive learning cache. An official run that
started online is never downgraded: if its completion loses the API, the signed
completion remains retryable.

The service worker atomically caches the document and every lazy game chunk by
build ID, while card art lives in a catalog-versioned cache. Every production
visit fills the 120-image base-art pack in small serialized batches; App Info
shows its progress. Live API configuration, account data, and leaderboards are
never cached. While disconnected, the primary navigation is unchanged — Play ·
Ladder · You never rename themselves. The player stays on the real page they
asked for, which names the cause with a header chip and renders absent server
data quietly (personal bests and ranks as `—`, the arena bar greyed, the Boards
scope reading "Boards need a connection") instead of a takeover. Reconnecting
refills the live data. The bundle-native Offline destination and the offline
nav-swap were retired in the 2026 refresh.
The API-outage state uses the same navigation and persistence rules without an
error/retry banner. A low-frequency health probe runs when the app regains focus,
becomes visible, restores browser transport, or reaches a 30-second interval;
the first successful response restores connected navigation and account hydration.

Anti-cheat treats automatic checks as triage, not truth. Signed challenge and
transcript consistency produce a deterministic candidate score; timing limits,
terminal-state expectations, score floors, completion-rate ceilings, and other
product assumptions produce machine-readable review signals. Current clients
also provide verified display-to-input observations, allowing the gate to
detect sustained subhuman response patterns without counting forced reveal or
card-transition time. A strict new season or all-time number one is held as a
neutral review queue entry even when no anomaly fired; an exact performance tie
is not a new leader. A signal derived
from a mode's own **difficulty curve** — Rain's minimum-time floor, the sum of
the spawn gaps a score of N cannot have skipped — is review-only on _both_ paths
and never rejects, not even the strict guest one: a difficulty model is the
assumption most likely to be wrong about an exceptional player. A scoreable
ranked run with any such signal is atomically recorded with a `review`/`hidden`
decision before it can appear publicly. The response includes
`underReview: true`; Discord promotion is suppressed. The Fair Play Referee can
confirm the hide or approve a false positive by writing a new, audited visible
decision. A run awaiting that decision **ranks provisionally**: the board shows
it in rank order with an Awaiting seal and the row says so in place of its
XP/games meta. Only an excluded run leaves the board, and only its owner sees
the explanation; the decision category and private rationale stay private. The
board row carries `reviewStatus: 'pending' | 'reviewed'` — `excluded` never
ships in a board response — and the superseded `refereeReviewed` boolean keeps
its narrower meaning (an actual referee clear) for one release so a browser on
the previous build marks the same rows it always did. The exception is
`seasonPodiumFinishers`, which still withholds a pending run: a provisional
placement is reversible, a finalized podium is not.
The three statuses are named **Cleared**, **Awaiting**, and **Excluded**, drawn
as the CSS struck-wax seal in `components/ReviewStatus.tsx` (no emoji, no art
file); `title`/`aria-label` carry the accessible name. A run no referee has
touched has **no status and no seal** — neither `reviewStatus` nor
`refereeReviewed` ships for it. Cleared means a referee examined that exact run,
so it must never be the default for an unexamined one.
`services/api/src/referee-status.ts` is the one classifier both the owner's
history and the public boards read, and its hidden branch fails closed. The public Fair Play page defines prohibited
automation, allowed settings/accessibility tools, review, and re-review through
`drop@poapkings.com`. A dispute should include the player-visible `#D…` run tag.
Only incomplete or contradictory input from which no comparable score
can be derived returns `400`; that attempt is still retained as referee evidence
under the canonical server-issued run UUID and is not labeled fake. The client
shows only its deterministic `#D…` Drop run tag. Scoreable holds use that tag to
join the immediate pending notice and owner history to the UUID-keyed evidence and
referee decision. The referee tools accept either form and fail closed if a short
tag is ever ambiguous. An unscored attempt has no
history row or review-status badge because no ranked result exists. Practice is
unranked, unscored, and XP-free — the run
exists only to feed the server-owned learning stats. Guest runs use
strict scoring but skip the integrity/referee path because they are never
recorded. Completion and the public read endpoints are also IP rate-limited
(guests included, since the per-IP
`run-start`/`run-complete` limits run before any auth branch; `/runs/complete`
at 300/hour; the shared
`reads` scope over `/leaderboards`, `/stats`, and `/seasons` at 1200/hour;
`share-mint` at 60/hour and `share-open` at 600/hour).

With Jamie's explicit approval, materially changed player-level evidence can
reopen an earlier referee judgment as a neutral hidden queue state. The owner
sees the Awaiting seal, the run keeps ranking provisionally, and the previous
judgment remains in immutable decision history; reopening does not label the run
excluded.

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
  the Drop app icon until the player chooses one.
- First-time setup leads with the required Player Card, then the generated
  player name. The optional Clash Royale tag stays out of setup; finishing
  returns to the requested game (or Home) and defers the tag reminder for seven
  days on that device.
- Clash Royale player tags are separate and unverified. Saving or reading a
  stale tag queues a refresh; snapshots are fresh for six hours and shared by
  tag. Drop shows CR name, clan, gameplay-derived Years Played account age, and
  the owned-card _count_. Experience, arena, trophies, wins, card levels, and
  the card collection grid are excluded — the grid has no use in Drop, only the
  count is shown. Drop's own arena (per-player, from Player XP) is native and
  unrelated to CR arenas.
- A signed-in player without a player tag is prompted at most once every seven
  days on that device. The reminder never appears during active play, does not
  stack over a release notice, and opens Profile directly at the tag field.
- Every game uses the complete canonical card catalog; ranked runs place on the
  seasonal leaderboard while Practice is unranked. The attached collection
  remains loaded and stored, but is not used for challenge generation and is not
  rendered. Historical unranked runs remain readable for compatibility.

---

## 7. Analytics

Tinylytics property:

- Site ID: `JjqvUeyEnrPM1f_iXrbU`
- Integer ID: `3445`

Analytics are best-effort and must never block gameplay.

The Tinylytics embed owns the initial document hit and browser interaction
events. Because GitHub Pages requires hash routing and Tinylytics' SPA observer
does not see those transitions, `apps/web/src/lib/analytics-loader.ts` sends a
browser collector hit for each distinct credential-free virtual route. Query
parameters are stripped, public player IDs collapse to `/players/profile`, and
the one-time-token `#/auth` route is never loaded or reported.

Event ownership is deliberately hybrid. The browser reports intent and device-
local outcomes; the API reports durable outcomes only after the operation that
makes them authoritative succeeds. A logical occurrence has exactly one owner:

| Owner                                     | Events                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (`apps/web/src/lib/analytics.ts`) | `game.started`, `game.replayed`, `game.shared`, `badge.shared`, every `install.*` event, and deliberate `easter_egg.screensaver_opened`. `game.completed` and `game.personal_best` remain browser-owned only for transient guest runs.                                                                                                                                           |
| API (`services/api/src/tinylytics.ts`)    | `account.login_requested` after mail delivery, `account.login_completed` after link redemption (value `new` or `returning`), `account.profile_completed` on the incomplete-to-complete transition, `game.completed` after a signed-in run transaction commits, and `game.personal_best` only when the conditional all-time projection improves. Completion retries emit nothing. |

Names are `category.action`, with at most one low-cardinality value (game mode,
login cohort, or browser/install family). Player ids, emails, public names,
tags, scores, run ids, seasons, transcripts, session tokens, and referee data
never cross this boundary.

For API-owned events, the Lambda forwards API Gateway's trusted client source IP
and browser user-agent together with the event, value, and credential-free route
path. This lets Tinylytics associate the server-confirmed outcome with the same
anonymous visit and derive country/browser context. Drop never stores or logs
those raw fields in analytics. Tinylytics documents that raw IPs are discarded
after country lookup, unresolved lookups may use IPinfo, and user-agent strings
are purged after seven days. Delivery is best-effort, attempted once with a
one-second timeout, and never changes the API response.

Tinylytics is the only analytics sink; there is no local mirror of these events.
A `community.*` category and an `elixirdrop:funnel` counter set existed for an
early in-app recruitment CTA. That concept was retired and removed in full — do
not reintroduce either without the surface that justifies them.

---

## 8. Design And Assets

Elixir Drop vendors its own visual layer:

- `apps/web/src/styles.css` contains the local tokens and components.
- `apps/web/public/assets/` contains the app icon set (`icon/`), badge art
  (`badges/`), mode emblems (`modes/`), empty-state art (`empty/`), run-start
  charge frames (`start/`), share furniture (`share/`), arena images, fonts, OG
  art, and the star asset.
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

**`CONTRIBUTING.md` → "The quality gate" is the canonical description** of what
each change-specific local command runs and where CI runs it. In short:
`validate-main.yml` provides the cancelable per-push gate,
`deploy.yml` promotes only a successful exact head, and `verify.yml` supplies
the exhaustive pull-request/manual/daily matrix. The Pages artifact is uploaded
from `apps/web/dist/` only after its required gate and API boundary pass.

Playwright browser/device projects are declared in
`apps/web/playwright.config.ts` — `chromium`, `firefox`, `webkit`, and `iphone-14`,
exactly the four the `verify` gate runs. Do not add a project the gate does not
run; an unexercised project is a false sense of coverage.

The main deployment gate runs all Chromium tests in two shards. Tests tagged
`@deploy` also run in Firefox, desktop WebKit, and iPhone WebKit; those tags are
reserved for critical journeys, engine regressions, offline behavior, and
recording/deployment boundaries. The daily `Verify` workflow runs every test in
all four projects.

The e2e suite is split by concern under `apps/web/tests/e2e/`, with shared API
stubs and helpers in `fixtures.ts`:

| Spec | Covers |
| --- | --- |
| `a11y.spec.ts` | Axe checks on every public hash route (including every game and a shared run) and every standalone page |
| `app-shell.spec.ts` | Stale-build reload, API-outage offline transition and automatic recovery |
| `auth.spec.ts` | Guest play and the save nudge, sign-in return path, favorite-card/name onboarding, saved-login retention during an outage |
| `offline.spec.ts` | Transport-offline and API-only outage behavior, all-mode local play, unsaved persistence boundaries, cached game chunks |
| `run-lifecycle.spec.ts` | Signed-run fallback, malformed-challenge rejection, official completion retry, permanent rejection |
| `gameplay-surge.spec.ts` · `gameplay-practice.spec.ts` · `gameplay-higher-lower.spec.ts` · `gameplay-modes.spec.ts` | Per-mode mechanics, card-art fallback, Rain's every-10 flash, Trade hints, low-chrome active play, the one-frame summary and its chart, the share function and what a shared link opens |
| `home.spec.ts` | The hero carousel, the desktop letterbox (wallpaper, the trimmed aside, Practice-first ordering and board reads), install suggestion timing, the Tinylytics hash-page/event bridge |
| `leaderboards.spec.ts` · `profile.spec.ts` | Board scoping including clans, public player pages, XP, settings persistence, CR tag states and the Updates-scope tag prompt |
| `meta-pages.spec.ts` · `screensaver.spec.ts` · `viewport-fit.spec.ts` | Static pages, the screensaver doors, keypad/control fit with no horizontal overflow, the ranked touch-only gate and its QR bridge |

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

Drop durably persists **referee-grade evidence** so Protect Fair Play
(`AGENT-TEAM/protect-fair-play.md`) can review leaderboard integrity
against exact server-side facts and make reversible run-visibility decisions.
The agent owns its judgment; Drop stores the audited decision overlay and
reconciles it into public leaderboards.

**What is captured.** On `/runs/complete`, best-effort (never failing or rolling
back a recorded run), one evidence item is written for:

- a **recorded ranked** run, whether accepted immediately or automatically
  quarantined for review, and
- an **unscored signed-in** attempt for which the current scorer could not
  derive a comparable candidate score.

Practice (`ranked:false`) and guest runs write **no** evidence.

**Where it lives.** `PLAYER#{sub}/EVIDENCE#{completedAt}#{runId}` in the main
table, co-located with the player's partition so account deletion
(`DELETE /me`) sweeps it for free. Each item carries: `runId`, `mode`,
`seasonId`, `runType` (`ranked`/`unscored`; legacy `rejected` remains readable), `integrityOutcome` (`accepted`, an
automatic-review reason, or an unscored reason), optional machine-readable
`reviewSignals`, server-recomputed candidate `score` (+ the mode's ordered
`tiebreaks`; evidence written before 2026-07-25 carries a flat `tiebreakMs`),
the coarse timing summary (`inferred-v1`, `observed-v2`, or an invalid-sidecar
marker), the full
signed `challenge`, the full raw `transcript`, `startedAt`/`completedAt`/
`wallElapsedMs`, a `scoringVersion` (`{ web: build sha, rules: SCORING_RULES_VERSION }`),
the normalized unverified `playerTag`, a `schemaVersion`, and an `expiresAt` TTL
(default **180 days** — active season plus the human review window). It contains
**no email**; the pseudonymous `playerId` is what the read scripts emit.

**Retention.** Evidence past its TTL returns `insufficient_evidence` for old
all-time entries (the referee rubric handles this); lengthen the TTL
(`EVIDENCE_TTL_SECONDS`) for deeper all-time review.

**What a player sees.** The overlay is not invisible. `referee-status.ts` is the
single classifier the public board and the owner's run log both read, so the two
cannot disagree about one run, and its hidden branch fails closed. The vocabulary
is **Awaiting / Cleared / Excluded**, drawn as the struck-wax seal in
`components/ReviewStatus.tsx`. Three rules govern it: a held run **ranks
provisionally** rather than disappearing (only `excluded` leaves a board); **an
unreviewed run wears no seal**, so a missing mark is never doubt; and **a summary
keys no referee at all**, because every run that just ended is awaiting one. The
reasoning behind the design is in `docs/referee-visibility.md`.

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
Season and all-time reads omit only excluded runs; if an excluded run was a
player's best, the board uses that player's next-best rankable run. A run held
for review still ranks. Approval restores an excluded run at its correct rank.
An automatic hold is pending on both the owner's page and the board; a referee
hide is owner-visible as excluded and appears on no board; and a referee-visible
result is publicly marked as cleared. No public endpoint returns an excluded run
or any private rationale.

The private **Drop Control Room** is a separate Preact app in `apps/admin`,
served by the loopback-only `services/admin` process on the managed host and
published only through Tailscale Serve. Its middle column is a persistent
searchable player directory (including email, Drop/Clash tags, and clan); the
wide player workspace exposes filterable run history, profile/CR details,
badges, ranked access, and deep run evidence. Run filters cover mode, review
state, completion date, native result, active time, season/tag/UUID, and sort
order. Operators can select individual ranked runs or all ranked runs in the
current filter and apply one reviewed, excluded, insufficient-evidence, or
reopened-pending decision to the selection. A second explicit confirmation is
required; the service then invokes the sanctioned decision command once per run
so every result keeps its own immutable audit event. Batches are bounded to 200,
and a partial failure returns the failed run IDs for selection and retry rather
than claiming the whole batch succeeded. Practice is not selectable because it
does not retain referee evidence. A run drill-down renders the exact retained
transcript as client submission JSON plus the complete sanitized evidence
envelope. The verified run token, authorization, raw IP, and raw user-agent are
intentionally never retained.

Referee reads and decisions remain adapters over the sanctioned
`AGENT-TEAM/scripts` and the pseudonymous `RefereeReadRole`. Account support is
a distinct child-process path in `services/admin/scripts/control-*.mjs`, run
under `DropControlRole`: it can project only account/profile and CR snapshot
fields, and can atomically correct `publicName` + `favoriteCardId` and/or the
unverified `playerTag` while writing an immutable
`CONTROL#PLAYER#{playerId}/CHANGE#...` audit item. Email is visible but is the
authentication key and therefore read-only; the role cannot read magic links,
poll sessions, run/evidence bodies, or secrets, and cannot edit email, runs,
scores, evidence, XP, or delete data. Production requires the exact
`Tailscale-User-Login`; every write additionally requires same-origin and CSRF
proof. The public Pages deployment contains none of this admin bundle.

Both subjects have deterministic read-aloud lookup aids: run UUIDs render as
`#D` plus ten Crockford Base32 characters and player UUIDs as `#P` plus ten.
These tags are identifiers, not authenticators; canonical UUID lookup fails
closed if a short tag is ever ambiguous. Player history displays the run tag
for every recorded game, regardless of review state.

A separately approved player-level item at
`REFEREE#PLAYER#{playerId}/CURRENT` can set ranked access to `restricted` or
`allowed`. `/runs/start` checks it for signed-in ranked modes; Practice remains
available. `referee-ranked-access.mjs` requires explicit Jamie approval and
writes immutable decision history under the same partition. This overlay never
edits or deletes the profile, history, scores, or evidence and is not implied by
any run-level decision.

---

_Unofficial fan project. Card data, names, and artwork © Supercell, used under
Supercell's Fan Content Policy. Not endorsed by Supercell._
