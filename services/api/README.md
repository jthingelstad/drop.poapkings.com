# Elixir Drop API

Strict TypeScript Lambda backend for Elixir Drop. It bundles to a Node.js 24
Lambda artifact and uses one DynamoDB table.

Responsibilities in this release:

- 15-minute, single-use email magic links sent through Fastmail JMAP;
- a daily Fastmail JMAP delivery canary using the same submission path as magic links;
- renewable 28-day sliding HMAC bearer sessions;
- player profiles with favorite-card avatars, safe Claude Haiku-generated
  public names, unverified CR player tags, and cached CR
  name/clan/account-age/card snapshots;
- short-lived, single-use signed runs for all five game modes;
- server-issued challenges, transcript validation, and server-recomputed scores;
- lifetime player game counts and server-computed Player XP feeding the 28-tier
  arena;
- a site-wide Trophy Road advanced by completed games from signed-in players;
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

- `POST /auth/request`, `POST /auth/redeem`, `POST /auth/refresh`
- `GET /me`, `PATCH /me`, `POST /me/name-options`
- `POST /runs/start`, `POST /runs/complete`
- `GET /leaderboards`, `GET /seasons`, `GET /stats`, `GET /health`

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

`GET /leaderboards?mode=…` takes an optional `scope`. `scope=season` (default)
returns the current or requested season board from the `LEADERBOARD#{seasonId}#{mode}`
GSI partition. `scope=all-time` returns the best-ever board: one item per player
per ranked mode (`pk = PLAYER#{sub}`, `sk = ALLTIME#{mode}`) indexed under
`LEADERBOARD#ALLTIME#{mode}` with the same sort-key encoding, so a player's rank
reflects their single best score across every season. The all-time item is
updated best-effort after a ranked completion (outside the `completeRun`
transaction) with a conditional write that only overwrites on a strictly better
sort key; a run that is not a new best is a silent no-op. Practice, being
unranked, has neither board.

`GET /stats` exposes `trophyRoadGames` as the site-wide Trophy Road counter. It
has one stable launch seed of 592, then advances exactly once for each
server-validated run—not for visits or analytics events. The Trophy Road
counter, real tracked-game count, player count, immutable run history, and
leaderboard entry are written in the same DynamoDB transaction, so a rejected
or duplicate run cannot move Trophy Road. Seasonal leaderboard resets do not
reset this counter.

## Player identity

The canonical card snapshot is the allowlist for profile identity. A player
posts `{ "favoriteCardId": 26000000 }` to `/me/name-options`; the API returns
safe names generated by Claude Haiku from that card's title, community
nicknames, mechanics, artwork, and personality, plus a signed, 15-minute choice
token. The exact title is not required in the name. The player then patches
`/me` with `favoriteCardId`, one returned `publicName`, and `nameToken`. The
signed token binds the exact safety-filtered choices to both the player and the
card, and DynamoDB stores the card and name in one update. The favorite card's
canonical artwork is the profile image in the web app.

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

## Referee evidence

On `/runs/complete`, the API writes best-effort **referee evidence** for every
recorded **ranked** run (after `completeRun` and the learning-stats block) and
for scorer-rejected signed-in runs (before the 400). A structurally valid run
that fails the plausibility check is recorded with an automatic
`review`/`hidden` decision in the same transaction, returns
`underReview: true`, and writes ranked evidence with the review reason. It is
excluded from seasonal and all-time leaderboards unless the referee approves
it. Practice (`ranked:false`) and guest runs write none. The evidence write is
best-effort like learning stats: it is wrapped so it can never fail or roll back
a recorded run.

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
