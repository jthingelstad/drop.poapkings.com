# Elixir Drop API

Strict TypeScript Lambda backend for Elixir Drop. It bundles to a Node.js 24
Lambda artifact and uses one DynamoDB table.

Responsibilities in this release:

- 15-minute, single-use email magic links sent from `elixir@poapkings.com`
  through Fastmail JMAP;
- a daily Fastmail JMAP delivery canary using the same submission path as magic
  links, sent to the monitored `drop@poapkings.com` administrative mailbox;
- Buttondown enrollment only after successful magic-link redemption, with
  current player/clan/activity metadata and matching removal on account
  deletion;
- renewable 28-day sliding HMAC bearer sessions;
- player profiles with favorite-card avatars, safe compiler-generated and
  Claude Haiku-ranked public names, unverified CR player tags, and cached CR
  name/clan/account-age/card snapshots;
- short-lived, single-use signed runs for all six game modes;
- server-issued challenges, transcript validation, and server-recomputed scores;
- identity-free, run-bound reports for terminal completion failures, with
  optional player context and a 180-day TTL;
- lifetime player game counts and server-computed Player XP feeding the 28-tier
  arena: fixed, performance-banded, and Practice-card game awards plus exact-once
  personal-best, featured, badge-rung, and season-final awards;
- a site-wide completed-games counter (the legacy response field is
  `trophyRoadGames`) advanced by completed games from signed-in players;
- per-mode best-score leaderboards driven by the live Clan Wars season clock,
  plus an all-time board of each player's best-ever score per mode; and
- best-effort Discord notifications for successful magic-link logins and every
  server-validated completed game.

The API never calls the Clash Royale API. Saving a player tag queues its first
fixed-IP bridge fetch. After that, a successful magic-link login queues a
refresh when the cached snapshot is stale; routine session restoration,
profile reads, polling, and games remain cache-only. The result consumer stores
only CR name, clan, the gameplay-derived `YearsPlayed` badge day count, and
card identity/art. Account age is calculated from the badge's `progress` days
rather than trusting its display tier.
Experience, arenas, trophies, wins, and card levels are excluded from the
message contract and persistence model. Every game uses the complete canonical
catalog. Attached collection data remains stored but not rendered; only the
card count is shown, and it does not affect challenge generation.

The bridge also publishes a five-minute Clan Wars clock snapshot from
`/currentriverrace` plus `/riverracelog`. The API stores the latest CR season
ID, current section/week, period/day, and phase in a singleton DynamoDB item.
A CR season-ID change creates the next leaderboard partition; the first live
snapshot deliberately retains the existing `YYYY-MM` partition so deployment
does not split an in-progress leaderboard. The API derives week countdown copy
from CR's period index and the agreed 10:00 UTC cutoff. If the clock is more
than two hours old, season reads and run completion fall back to the UTC
first-Monday calendar instead of failing.

## Routes

- `POST /auth/request`, `POST /auth/redeem`, `POST /auth/refresh`, `POST /auth/poll`
- `GET /me`, `PATCH /me`, `DELETE /me`, `POST /me/name-options`
- `POST /runs/start`, `POST /runs/complete`, `POST /run-reports`, `POST /runs/{runId}/share`
- `GET /leaderboards`, `GET /players/{playerId}`, `GET /seasons`, `GET /stats`, `GET /activity`, `GET /shares/{token}`, `GET /health`

Starting and completing a run make the player session **optional**, so anyone
can play as a guest. With a valid session, `/runs/start` runs the ranked flow
(profile favorite card + public name required) and `/runs/complete` records the
run. With **no** session, `/runs/start` deals the same server-signed challenge
under the reserved `guest` owner sentinel (it can never collide with a real
base64url-SHA-256 sub), marks the run `guest: true`, always unranked, and signs
the run token `guest: true`; the per-IP `run-start` rate limit runs first so it
still covers signed-out callers. On completion, a guest run is scored with
`scoreRun` (validate + recompute) but the integrity check and **every** recording
step are skipped — no `completeRun`, XP, leaderboard, all-time best, Discord, or
learning stats — and the run row is left to TTL-expire. A guest completion
returns the minimal shape `{ accepted: true, guest: true, mode, score, season }`.
A `/runs/complete` presenting a non-guest run token still requires a session
that owns the run. The public site and leaderboards remain browsable without an
account.

`POST /run-reports` is the best-effort diagnostic path for a signed run whose
completion reaches a terminal 4xx response. It accepts the run ID/token, the
failure code/status, coarse client state (build, online/visibility, and browser
versus installed display mode), and optional context capped at 1,000 characters.
The API verifies the signed run or its signed-in owner, derives the `#D…`
reference server-side, and idempotently upserts one `RUN_REPORTS/REPORT#{runId}`
item. Repeating the request attaches context to the same report. Reports expire
after 180 days and never contain email, account subject, session/run tokens, a
raw IP/user-agent, or a transcript. The per-IP `run-report` rate limit is
120/hour.

Signed-in completions aggregate validated card outcomes into the player's
server-owned `CARDSTATS` item and copy only the validated answer count—not the
raw transcript—onto immutable run history. Practice therefore retains the
per-card learning signal used by `/me` coaching summaries while giving the Reps
badge a history-backed recovery path for newly recorded sessions.

Badge bags are referee-aware derived projections. A final excluded ranked run
is removed from history-backed counters, exact card-knowledge contributions,
and run-timestamped hidden awards on the next owner or public profile read.
Every ranked-run decision atomically increments a player-scoped revision in the
`REFEREE#` partition, so bulk decisions cannot leave a seemingly current stale
bag. Pending holds do not remove badges. A later audited restoration rebuilds
again and restores the run's contribution; canonical run, XP, learning, and
evidence records remain unchanged.

Daily Drop is a cumulative distinct-played-day badge, not a streak: one recorded
local calendar day in any mode (Practice included) advances it once. Repeated
runs that day advance Marathon instead. Guest and offline runs move neither;
legacy backfills use the UTC date already available on immutable history.

## Player XP

XP v2 values live in `@elixir-drop/contracts`; `/xp/` is generated from those
same constants. `completeRun` atomically records the game award: Surge 15,
Trade 100, performance bands for Higher / Lower, Survival, and Rain, or one XP
per two Practice cards using the player's durable odd-card carry. Practice has
no payout cap, remains unranked, and must pass its signed-deck validation plus
the server wall-clock completion-rate floor. Guest and offline runs never reach
this path.

Post-run PB (+10, first result counts, three paid per UTC day) and featured
(+5, once per UTC day) bonuses use immutable player-partition markers. Badge
rungs pay 5/10/25/50 by visible tier, 25 for a hidden single rung, and 100 for
Collector. `GET /me` and `GET /players/{id}` reconcile all already-earned badge
markers and settle the finite Arena Climber cascade, so the badge migration is
lazy, resumable, and needs no privileged bulk writer.

Beginning with Season 135 (`2026-08`), the CR rollover result consumer uses final referee-aware standings
with pending runs withheld. Each ranked mode's occupied top 20 pays
500/350/250/150/100/50 by placement band, and a positive final score in all five
ranked modes pays +100 Seasonal Circuit. The same SQS retry that protects the
Podium badge protects these exact-once markers. Current XP is always the opening
balance; only badge rungs are retroactive.

## Sharing a run

`POST /runs/{runId}/share` mints a share token for a run the caller owns, and
`GET /shares/{token}` resolves it. The token is six characters from an alphabet
with no look-alike glyphs (no I, L, O, U, 0, or 1) — a player may end up reading
one aloud. See `src/shares.ts`.

**One token per share ACTION, not per run.** Sharing the same run twice mints two
tokens; that is what makes reach countable per share rather than per run.

**A not-recorded run cannot mint.** Guest and Practice runs, and any run that has
not finished scoring, are refused `409 run_not_recorded`. The browser hides the
control entirely rather than disabling it, and this endpoint is the second lock
on the same rule — an endpoint that trusts the button has no rule at all.

The share item carries a durable snapshot (mode, score, season, completedAt, the
public `playerId`, and the run's own display-only series) rather than pointing at
the ephemeral `RUN#` row, because a link a player already sent has to keep
working after that row TTLs out. `owner` is stored but never returned: it exists
so an open from the sharer's own device can be dropped. The response carries only
what the public profile already shows — score, mode, name, arena.

**Counting opens.** A distinct visitor is credited once per token. The dedupe key
is a peppered one-way HMAC of the request scoped to that token, so a refresh, a
link preview, and a second tap are one open; Drop counts opens per token and
never learns who opened, and no raw IP or user-agent is stored. The sharer's own
device earns nothing, and credit stops at 25 per token so one lucky link cannot
clear a badge ladder. Crediting is best-effort and never blocks the read: a link
opens whether or not the count lands. `share-mint` is rate-limited at 60/hour and
`share-open` at 600/hour per IP.

The share item lives outside `PLAYER#` so a stranger can resolve it by token
alone. A `PLAYER#{sub}/SHARE#{token}` pointer is written in the same transaction,
and account deletion follows it to sweep the share and its per-visitor open
markers — a link that outlived the account would keep naming a player who left.

`GET /players/{playerId}` backs read-only profiles opened from leaderboards and
recent activity. It resolves the pseudonymous player UUID through the sparse
`GSI3` index, filtering and paginating until it finds the `PROFILE` row because
audited account-support records can carry the same pseudonymous ID, and returns
only public identity, progress, the already-public player tag when present, and
sanitized recent ranked runs. Email,
authentication subject, and DynamoDB storage keys never cross this response
boundary.

`GET /leaderboards?mode=…` takes an optional `scope`. `scope=season` (default)
returns the current or requested season board from the `LEADERBOARD#{seasonId}#{mode}`
GSI partition. `scope=all-time` returns the best-ever board: one item per player
per ranked mode (`pk = PLAYER#{sub}`, `sk = ALLTIME#{mode}`) indexed under
`LEADERBOARD#ALLTIME#{mode}` with the same sort-key encoding, so a player's rank
reflects their single best score across every season. The all-time item is
updated best-effort after a ranked completion (outside the `completeRun`
transaction) with a conditional write that only overwrites on a strictly better
sort key; a run that is not a new best is a silent no-op. Practice, being
unranked, has neither board. All-time rows created before earning `runId` was
projected are resolved against immutable player history before referee decisions
are applied; an unresolved row fails closed instead of bypassing review.

A ranked completion must score **above zero** to earn either leaderboard
projection. Zero-score attempts remain valid run history and still earn Player
XP, but they do not receive seasonal GSI keys or an all-time row. Reads also
filter legacy zero projections defensively. Operators can remove stale sparse
index keys without changing canonical history using the dry-run-first
`cleanup:zero-leaderboards` script.

`GET /stats` exposes the legacy-named `trophyRoadGames` field as the site-wide
completed-games counter, surfaced on Home as **games played across Drop**. It
has one stable launch seed of 592, then advances exactly once for each
server-validated run—not for visits or analytics events. The public counter,
real tracked-game count, player count, immutable run history, and any eligible
leaderboard entry are written in the same DynamoDB transaction, so a rejected
or duplicate run cannot move it. Seasonal leaderboard resets do not reset this
counter.

## Player identity

The canonical card snapshot is the allowlist for profile identity. A player
posts `{ "favoriteCardId": 26000000 }` to `/me/name-options`; the API returns
five names from a fresh server-composed slate of reviewed card flavor and safe
humor patterns, plus a signed, 15-minute choice token. Claude Haiku selects only
opaque candidate IDs; model-authored text can never become a public name.
Unknown IDs are ignored, one choice per humor lane is preferred, and a failed
or incomplete model response is filled from the same safe slate. The exact card
title is not required in the name. A completeness test requires reviewed flavor
for every canonical card. The player then patches `/me` with `favoriteCardId`,
one returned `publicName`, and `nameToken`. The signed token binds the exact
choices to both the player and the card, and DynamoDB stores the card and name
in one update. The favorite card's canonical artwork is the profile image in
the web app.

Changing a favorite card uses the same complete flow and replaces both card and
name. `playerTag` remains an independent, unverified profile field.

## Discord events

`ELIXIR_DROP_DISCORD_WEBHOOK_URL` is a server-only deployment secret. Successful
magic-link redemption and completed games each post one compact text line with
the useful player, progress, mode, score, and season context. Completed-game
events also include the cached CR name, tag, and clan when attached; they never
request a CR refresh. Session tokens, magic links, IP addresses, verbose
clients, and correlation IDs stay out of Discord; request/run IDs remain in
CloudWatch logs. Delivery is best effort with a three-second timeout and never
changes an otherwise successful API response.

The fixed-IP bridge uses the same locally stored webhook to record successful
and not-found CR player pulls as one-line text with the tag, CR name, clan,
account age, collection size, and fetch duration. Job IDs remain in the local
worker and Lambda logs. Discord never includes competitive rank data or card
levels, and delivery failure never blocks queue completion.

## Release-news subscribers

`BUTTONDOWN_API_KEY` and `BUTTONDOWN_NEWSLETTER_ID` are server-only deployment
settings. A successful magic-link redemption adds the verified address as a
regular subscriber, so Buttondown does not send a redundant confirmation
message. Repeat login collisions never overwrite Buttondown's unsubscribe or
suppression state: collisions and later syncs PATCH metadata only. Subscriber
metadata uses segment-friendly `player_tag`, optional `clan_tag`, and numeric
`total_games` keys. It refreshes at verified login, each returning-session
renewal, a profile/tag change, and every recorded game; the current clan comes
only from the latest bridge-owned CR snapshot. A known no-clan result clears a
stale clan value, while an unavailable/pending snapshot preserves the last
known value. Account deletion removes the subscriber by email. These calls are
best effort with a three-second timeout and never change an otherwise
successful login, profile update, run completion, or deletion response.

## Buttondown metadata backfill

`scripts/backfill-buttondown-metadata.mjs` synchronizes `player_tag`, known
`clan_tag`, and numeric `total_games` onto existing Buttondown subscribers. It
reads only the bounded account-directory projection through `drop-control`,
never prints email addresses or credentials, preserves unrelated subscriber
metadata and lifecycle state, and refuses an apply if any current player has no
matching subscriber. It is dry-run by default and idempotent:

```sh
AWS_PROFILE=drop-control AWS_REGION=us-east-1 npm run backfill:buttondown-metadata --workspace=@elixir-drop/api -- --env-file "$PWD/.env"
AWS_PROFILE=drop-control AWS_REGION=us-east-1 npm run backfill:buttondown-metadata --workspace=@elixir-drop/api -- --env-file "$PWD/.env" --apply
```

## Tinylytics product events

`TINYLYTICS_API_TOKEN` is an optional server-only full-access key for the active
Elixir Drop Tinylytics property (numeric site ID `3445`). The browser continues
to own page views and interaction intent. The API owns successful magic-link
requests and redemptions, the first completed profile transition, recorded
signed-in game completions, and conditional all-time personal bests. A recorded
run retry replays its response without sending another event; guest outcomes
remain browser-owned because guest runs are intentionally transient.

API events contain only the event name, a low-cardinality value when useful,
the credential-free product path, API Gateway's trusted client source IP, and
the browser user-agent. They never include player/account identifiers, email,
tags, scores, run/season IDs, tokens, transcripts, or referee data. Tinylytics
delivery is best effort, has a one-second timeout and no retry, and never changes
the API response.

## Referee evidence

On `/runs/complete`, the API writes best-effort **referee evidence** for every
recorded **ranked** run (after `completeRun` and the learning-stats block) and
for unscored signed-in attempts (before the 400). Timing, end-state, and other
assumption-based scorer failures now return a deterministic candidate score plus
machine-readable review signals. Such a run is recorded with an automatic
`review`/`hidden` decision in the same transaction and returns
`underReview: true`. **It still ranks.** The board reads
`src/referee-status.ts`, where a pending decision ranks provisionally and only
`excluded` removes a row; the one read that still withholds a pending run is
`seasonPodiumFinishers`, because a provisional placement is reversible and a
finalized podium is not. Only input from which no comparable score can be derived remains
unrecorded, while its evidence is retained without treating the automatic label
as an integrity verdict. Practice (`ranked:false`) and guest runs write none.
The evidence write is best-effort like learning stats: it is wrapped so it can
never fail or roll back a recorded run.

New evidence uses `runType: "unscored"` when no candidate score can be derived;
the referee feed also recognizes legacy `"rejected"` items. The referee may
record a `clear`, `watch`, `review`, or `insufficient_evidence` disposition with
`visibility: "not_ranked"`. That judgment is authoritative about integrity, but
does not invent a leaderboard score; a sanitized reconciliation issue is the
path for making genuine play scoreable.

## All-time projection backfill

`scripts/backfill-all-time.mjs` rebuilds the one-row-per-player/mode all-time
projection from immutable ranked history. It excludes unranked Practice and
retired pre-r2 Survival results as well as zero-score attempts, uses the
production sort/tiebreak rules, and conditionally refuses to overwrite a better
concurrent result. It is dry-run by default:

```sh
AWS_REGION=us-east-1 npm run backfill:all-time --workspace=@elixir-drop/api
AWS_REGION=us-east-1 npm run backfill:all-time --workspace=@elixir-drop/api -- --apply
```

`referee-evidence.ts` shapes and stamps each item; `repository.putRefereeEvidence`
does the plain put. Items live at `PLAYER#{sub}/EVIDENCE#{completedAt}#{runId}`
so account deletion sweeps them, and carry the full signed challenge, the raw
transcript, timing, server-recomputed score, integrity outcome, the normalized
`playerTag`, and a TTL (`EVIDENCE_TTL_SECONDS`, default 180 days). They contain
**no email**.

**Versioning.** Every item stamps `scoringVersion: { web, rules }` — the
front-end build sha (`WEB_VERSION`) plus `SCORING_RULES_VERSION` (exported from
`scoring.ts`). Bump `SCORING_RULES_VERSION` whenever `scoring.ts` / `integrity.ts`
rules change so historical evidence stays interpretable.

**Connection correlation.** At start and complete the handler derives peppered
HMAC hashes of the request IP and user-agent (`deriveCorrelation`) and discards
the raw values — no raw IP or user-agent is ever stored. `TELEMETRY_PEPPER` is a
required server secret (Lambda env only, guarded like `SESSION_SECRET`; never in
the referee scripts, the referee role, CI, or the browser). The bounded surface
is in `AGENT-TEAM/scripts/` (see that README), run under `RefereeReadRole`; the
physical name is retained for compatibility. Scripts never see the pepper,
`sub`, email, or a raw IP. The role may write only independent `REFEREE#`
decision records. Repository leaderboard reads apply those decisions, falling
back to a player's next-best visible run when a best run is hidden and restoring
the original ordering after approval.

Run `npm run verify --workspace=@elixir-drop/api` from the repository root to
type-check, test, and bundle the service.
