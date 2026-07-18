# Elixir Drop API

Strict TypeScript Lambda backend for Elixir Drop. It bundles to a Node.js 24
Lambda artifact and uses one DynamoDB table.

Responsibilities in this release:

- 15-minute, single-use email magic links sent through Fastmail JMAP;
- renewable 10-day HMAC bearer sessions;
- player profiles, safe generated public names, and unverified CR player tags;
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

Run `npm run verify --workspace=@elixir-drop/api` from the repository root to
type-check, test, and bundle the service.
