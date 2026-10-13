# Elixir Drop API

Strict TypeScript HTTP backend for Elixir Drop. A native Node.js 24 server runs
on a Lambda Web Function behind CloudFront OAC and uses one DynamoDB table.
`src/app.ts` owns dispatch; `src/server.ts` owns body limits, proxy trust, CORS,
and writing text/binary responses; `src/index.ts` binds the runtime-provided
`AWS_LAMBDA_HTTP_ENDPOINT`. Queue consumers remain separate Event Functions.

Responsibilities in this release:

- Sign in with Elixir, the only sign-in since 2026-10-12 (a Drop account is an
  Elixir account; guests play without one), resolved through the
  `ELIXIR#{accountId}` identity pointer;
- renewable 28-day sliding HMAC bearer sessions;
- player profiles with favorite-card avatars, safe compiler-generated and
  Claude Haiku-ranked public names, unverified CR player tags, and cached CR
  name/clan/account-age/card snapshots;
- short-lived, single-use signed runs for all six game modes;
- server-issued challenges, transcript validation, and server-recomputed scores;
- identity-free, run-bound reports for terminal and retryable completion
  failures, with optional player context and a 180-day TTL;
- lifetime player game counts and server-computed Player XP feeding the 28-tier
  arena: fixed, performance-banded, and Practice-card game awards plus exact-once
  personal-best, featured, badge-rung, and season-final awards;
- a site-wide completed-games counter (the legacy response field is
  `trophyRoadGames`) advanced by completed games from signed-in players;
- API-backed player Updates with bounded inline Markdown, a public JSON feed,
  archive, and RSS projection, plus one bearer-protected publication route;
- per-mode best-score leaderboards driven by the live Clan Wars season clock,
  plus an all-time board of each player's best-ever score per mode.

The API never calls the Clash Royale API. It reads recorded player data from
Elixir MCP, with a hub-managed live fallback for a previously unseen tag. Saving
a tag and verified login retain their enrichment behavior. Returning-session
refresh validates the account and awaits only acceptance by a dedicated encrypted
FIFO refresh queue (750 ms enqueue deadline). A separate Lambda refreshes the
six-hour player snapshot. The queue contains an internal subject and account
generation, never an email or session. Deleted or recreated accounts are
ignored. (Until 2026-10-12 it also synchronized Drop's newsletter metadata; the
inert `PLAYER#{sub}/REFRESH#METADATA` digests it left go with account
deletion.)

Public reads serve the stored Clan Wars clock, retaining the existing calendar
fallback. When the clock is older than five minutes, reads enqueue refresh instead
of waiting for MCP. FIFO deduplication coalesces requests for five minutes and
serializes clock jobs. The worker finalizes the previous season before advancing
the stored clock; idempotent award markers protect retries after interruption.
MCP requests have a three-second deadline, including response-body consumption.
The refresh queue replaces the retired Supercell bridge path.

`api.timings` structured logs record the route template, first-request flag,
request elapsed time, and fixed operation labels for DynamoDB, MCP and queue work.
The worker also times metadata writes and season finalization. Operation times
may overlap and must not be summed as request latency. No request arguments,
identities, tokens or payloads are included. Web Function `platform.initReport` events provide initialization timing;
CPU and active environment time are environment-level measurements.

## Routes

- `POST /auth/elixir/start`, `GET /auth/elixir/callback`, `POST /auth/redeem`, `POST /auth/refresh`, `POST /auth/poll`
- `POST /me/elixir/select`, `DELETE /me/elixir`
- `GET /me`, `PATCH /me`, `DELETE /me`, `POST /me/name-options`
- `POST /runs/start`, `POST /runs/complete`, `POST /run-reports`, `POST /runs/{runId}/share`, `PUT /runs/{runId}/share`
- `GET /practice/resume`, `POST /practice/checkpoint`
- `POST /badges/{badgeSlug}/share`, `PUT /badges/{badgeSlug}/share`
- `GET /share/{playerTag}/{runTag}`, `GET /share-assets/{playerTag}/{runTag}`, `POST /share/{playerTag}/{runTag}/open`
- `GET /share/{playerTag}/badge/{badgeSlug}/{rung}`, `GET /share-assets/{playerTag}/badge/{badgeSlug}/{rung}`
- `GET /share/{playerTag}/invite`
- `GET /leaderboards`, `GET /players/{playerId}`, `GET /seasons`, `GET /stats`, `GET /activity`, `GET /shares/{token}`, `GET /health`
- `GET /updates`, `GET /updates/archive`, `GET /feed.xml`, `POST /admin/updates` (bearer token)

Player Updates are immutable `UPDATES/ENTRY#{id}` records. The public JSON,
archive HTML, and RSS feed are rendered from the same validated records. The
public CDN maps canonical `/updates/` requests to the internal archive route. The
write route publishes immediately, accepts only one short paragraph with
emphasis, strong text, inline code, and safe links, and is callable only through
the dedicated fixed-host bearer token. Repeating identical copy under the same
id is idempotent; changed copy conflicts instead of rewriting history.

Sign in with Elixir is the only way into an account (SPEC.md "Sign in with
Elixir" owns the flow and the identity pointer). The Elixir callback mints a
15-minute, single-use, never-mailed sign-in link (`MAGIC#`, `source: "elixir"`,
carrying the resolved `sub`); `POST /auth/redeem` accepts only `{ token }` for
such a link and refuses anything else. The email-code route `POST
/auth/request` was removed on 2026-10-12 and answers 404.

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

Signed-in Practice checkpoints are recovery data, never partial completions.
`POST /practice/checkpoint` accepts one contiguous 20-answer chunk, validates
its session/run ownership and signed-deck membership, recomputes correctness,
and atomically advances a player-partition cursor. Identical retries are
idempotent; gaps and divergent chunks fail closed. `GET /practice/resume` returns
the contiguous active draft and a reissued token only while the original
24-hour run is valid; `?summary=1` omits the transcript for Home. Items use the
run TTL, account deletion sweeps them, and successful completion removes the
active cursor. No checkpoint path writes history, learning, XP, badges, Trophy
Road, or a board. Guest and offline Practice never call it.

`POST /run-reports` is the best-effort diagnostic path for a signed run whose
completion fails after bounded automatic recovery. It accepts the run ID/token,
the failure code/status (`0` for client transport failures, or HTTP `4xx`/`5xx`),
coarse client state (build, online/visibility, and browser versus installed
display mode), and optional context capped at 1,000 characters.
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

Beginning with Season 135, the CR rollover result consumer uses final referee-aware standings
with pending runs withheld. Each ranked mode's occupied top 20 pays
500/350/250/150/100/50 by placement band, and a positive final score in all five
ranked modes pays +100 Seasonal Circuit. The same SQS retry that protects the
Podium badge protects these exact-once markers. Current XP is always the opening
balance; only badge rungs are retroactive.

## Sharing and recruitment

`POST /runs/{runId}/share` publishes the caller's immutable history row at one
deterministic `/share/{playerTag}/{runTag}` address. The public path uses Drop's
existing `P…` player tag and `D…` run tag while UUIDs remain internal. Repeated
calls return the same URL. Because publication reads durable history, the finish screen and You → Log
can use the same endpoint, including for older runs whose active `RUN#` row has
expired. Practice, absent, and Fair Play-excluded results fail closed.

The published item freezes only public result/profile facts. `share-visual.ts`
derives a bounded chart from validated referee evidence. New completions retain
that projection on the history row, while the first share of an older run
backfills it. The web canvas compositor renders that server-owned projection
with the same real Clash font and PNG art pipeline as badge cards, then `PUT
/runs/{runId}/share` accepts only the authenticated owner's bounded 1200 × 630
PNG. `share-assets.ts` keeps it permanently in the dedicated private S3 bucket.
`GET /share/{playerTag}/{runTag}` serves the standalone unfurl/landing HTML;
`GET /share-assets/{playerTag}/{runTag}` serves the PNG and uses the polished
generic preview while a legacy run has not yet been reshared into the new image version.

An earned badge rung publishes through the parallel owner-only `POST
/badges/{badgeSlug}/share` contract at
`/share/{playerTag}/badge/{badgeSlug}/{rung}`. The public rung is one-based; UUIDs
and the zero-based index stay internal. The endpoint independently verifies the
earned timestamp in server-owned badge counters and freezes the public player,
badge, tier, milestone, and rung facts. The browser renders and `PUT`s the same
bounded 1200 × 630 run-style card, and the retained PNG lives under the private
`badge-images/{playerId}/` prefix. Badge and run landings share the metadata,
visible alt text, CTA, profile, font, and fan-content shell.

Metadata and preview-image GET/HEAD requests do not count toward Herald. A real
landing page runs `POST /share/{playerTag}/{runTag}/open`; its peppered HMAC
dedupes a visitor without retaining the raw IP or full user-agent. The owner's
session earns nothing, credit caps at 25 per run, and counter failure never
blocks the page. The landing also carries the public player/run pair as 30-day
last-touch Recruiter attribution.

Badge landings carry deterministic 30-day Recruiter attribution but never
advance Herald. `POST /shares` still mints a six-character Home or public-profile invitation
token for Home sharing. `GET /shares/{token}` also remains as the
compatibility resolver for previously issued run tokens. Invitation opens never
advance Herald, and previously issued badge invitations remain readable.
Account deletion follows token, published-run, and published-badge pointers,
sweeps their visitor markers and snapshots, and deletes both player S3 prefixes.

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
GSI partition. Seasonal reads start with 200 runs, then use up to 1,000 per
continuation page within the existing 2,000-run/ten-page budget. Review reads
check each unseen player's leading candidate first, and lower candidates only
when needed for an excluded run or a pending final award. Decisions remain
strongly consistent and are never cached between requests.
`scope=all-time` returns the best-ever board: one item per player
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

## No mailing list

Drop sends no mail and keeps no mailing list (2026-10-12). Elixir's one list
is the channel out to players; a player joins or leaves it in their Elixir
account, and the API never writes to it. Sign-in, profile changes and run
completion make no list call, and account deletion unsubscribes nobody. Drop's
Buttondown newsletter, its subscriber-metadata sync and its backfill script
are retired, as is the email-code sign-in's SES sender.

## Elixir identity backfill

`src/maintenance/backfill-elixir-identity.ts` wrote the `ELIXIR#{accountId}`
pointer (and the profile's internal `elixirAccountId`) for the accounts that
predate Elixir-only sign-in. It uses the sign-in's own conditional transaction
(`Repository.bindElixirAccount`, without a connection), so a rerun is a no-op,
a pointer naming another account is reported and never overwritten, and a
profile bound to another Elixir account is left alone. It does not write the
Elixir connection or the verified mark: those need the person's Elixir
players, which their next sign-in reads.

Its inputs stay outside the repository, which is public. `--accounts` is
Elixir's account list (`account_role` list op in elixir-mcp: account id, kind,
status and a ten-hex email hash prefix); only an approved person is a target,
matched when the prefix begins `hex(sub)`. The optional `--map` is a JSON array
of `{ "playerIdPrefix", "accountId" }` pairings for a person whose Elixir
address differs from their Drop address. Output is counts only. It is a dry run
by default, requires `ProjectsCloudEngineer`, and an apply runs under the
production lock:

```sh
AWS_PROFILE=cloud-engineer AWS_REGION=us-east-1 npm run backfill:elixir-identity --workspace=@elixir-drop/api -- --accounts /tmp/accounts.json --map /tmp/pairings.json
node scripts/production-lock.mjs run --purpose "Elixir identity backfill" -- env AWS_PROFILE=cloud-engineer AWS_REGION=us-east-1 npm run backfill:elixir-identity --workspace=@elixir-drop/api -- --accounts /tmp/accounts.json --map /tmp/pairings.json --apply
```

## Season-number storage migration

`scripts/migrate-season-numbers.mjs` is the bounded one-time DynamoDB migration
from retired calendar keys to numeric Clash season IDs. It scans without
printing player or run identifiers, classifies every affected shape, and is a
dry run by default. Apply is restricted to the production table, region,
account, and operator identity; attribute updates use exact old-value
conditions, primary-key moves are transactional, and apply finishes by running
the inventory again and requiring zero remaining actions or unresolved shapes.

```sh
npm run migrate:season-numbers --workspace=@elixir-drop/api
npm run migrate:season-numbers --workspace=@elixir-drop/api -- --apply
```

## Tinylytics

The API publishes no Tinylytics events and holds no Tinylytics credential; the
browser owns all analytics (`SPEC.md` §7). A recorded completion returns
`personalBest: true` when the conditional all-time projection improved, so the
browser can report `game.personal_best` for signed-in players.

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
is in `scripts/referee-*.mjs` (see `scripts/README.md`), run under `RefereeReadRole`; the
physical name is retained for compatibility. Scripts never see the pepper,
`sub`, email, or a raw IP. The role may write only independent `REFEREE#`
decision records. Repository leaderboard reads apply those decisions, falling
back to a player's next-best visible run when a best run is hidden and restoring
the original ordering after approval.

Run `npm run verify --workspace=@elixir-drop/api` from the repository root to
type-check, test, and bundle the service.
