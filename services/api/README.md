# Elixir Drop API

Strict TypeScript Lambda backend for Elixir Drop. It bundles to a Node.js 24
Lambda artifact and uses one DynamoDB table.

Responsibilities in this release:

- 15-minute, single-use email magic links sent through Fastmail JMAP;
- renewable 10-day HMAC bearer sessions;
- player profiles with favorite-card avatars, card-scoped generated public names,
  unverified CR player tags, and cached CR name/clan/account-age/card snapshots;
- short-lived, single-use signed runs for all ten game modes;
- server-issued challenges, transcript validation, and server-recomputed scores;
- lifetime player game counts and a gradual level curve;
- global completed-game Trophy Road totals, including anonymous games; and
- per-mode best-score leaderboards in Clan Wars-aligned UTC seasons; and
- best-effort Discord notifications for successful magic-link logins and every
  server-validated completed game.

The API never calls the Clash Royale API. Saving or reading a stale player tag
queues a refresh for the fixed-IP bridge. The result consumer stores only CR
name, clan, the gameplay-derived `YearsPlayed` badge day count, and card
identity/art. Account age is calculated from the badge's `progress` days rather
than trusting its display tier.
Experience, arenas, trophies, wins, and card levels are excluded from the
message contract and persistence model. Surge, Practice, Identify,
Higher/Lower, Blitz, and Survival use an attached collection when at least 12
canonical cards are available; other modes keep using the complete catalog.

## Routes

- `POST /auth/request`, `POST /auth/redeem`, `POST /auth/refresh`
- `GET /me`, `PATCH /me`, `POST /me/name-options`
- `POST /runs/start`, `POST /runs/complete`
- `GET /leaderboards`, `GET /seasons`, `GET /stats`, `GET /health`

## Player identity

The canonical card snapshot is the allowlist for profile identity. A player
posts `{ "favoriteCardId": 26000000 }` to `/me/name-options`; the API returns
safe names derived only from that card plus a signed, 15-minute choice token.
The player then patches `/me` with `favoriteCardId`, one returned `publicName`,
and `nameToken`. The signed token binds the exact choices to both the player and
the card, and DynamoDB stores the card and name in one update. The favorite
card's canonical artwork is the profile image in the web app.

Changing a favorite card uses the same complete flow and replaces both card and
name. `playerTag` remains an independent, unverified profile field.

## Discord events

`ELIXIR_DROP_DISCORD_WEBHOOK_URL` is a server-only deployment secret. Successful
magic-link redemption and completed games each post one compact text line with
the useful player, progress, mode, score, and season context. Session tokens,
magic links, IP addresses, verbose clients, and correlation IDs stay out of
Discord; request/run IDs remain in CloudWatch logs. Delivery is best effort with
a three-second timeout and never changes an otherwise successful API response.

The fixed-IP bridge uses the same locally stored webhook to record successful
and not-found CR player pulls as one-line text with the tag, CR name, clan,
account age, collection size, and fetch duration. Job IDs remain in the local
worker and Lambda logs. Discord never includes competitive rank data or card
levels, and delivery failure never blocks queue completion.

Run `npm run verify --workspace=@elixir-drop/api` from the repository root to
type-check, test, and bundle the service.
