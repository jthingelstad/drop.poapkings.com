# Elixir Drop API

Strict TypeScript Lambda backend for Elixir Drop. It bundles to a Node.js 24
Lambda artifact and uses one DynamoDB table.

Responsibilities in this release:

- 15-minute, single-use email magic links sent through Fastmail JMAP;
- renewable 10-day HMAC bearer sessions;
- player profiles with favorite-card avatars, card-scoped generated public names,
  and unverified CR player tags;
- short-lived, single-use signed runs for all ten game modes;
- server-issued challenges, transcript validation, and server-recomputed scores;
- lifetime player game counts and a gradual level curve;
- global completed-game Trophy Road totals, including anonymous games; and
- per-mode best-score leaderboards in Clan Wars-aligned UTC seasons.

The API never calls the Clash Royale API. A future bridge may cache a tagged
player's card collection; challenge generation already accepts an optional
canonical card pool so each mode can choose whether to use that context.

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

Run `npm run verify --workspace=@elixir-drop/api` from the repository root to
type-check, test, and bundle the service.
