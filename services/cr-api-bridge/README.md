# Clash Royale API Bridge

This TypeScript worker runs on the Elixir Drop Mac with the fixed, Clash Royale
API-allowlisted IP address.

Its boundary is intentionally narrow:

- long-poll the `elixir-drop-cr-requests` SQS queue using a dedicated
  least-privilege IAM identity;
- call `/players/{tag}` using the CR token in the gitignored root `.env`;
- normalize name, clan, Years Played account age, and cards without competitive
  fields or card levels;
- every five minutes, call POAP KINGS' `/currentriverrace` and `/riverracelog`
  endpoints and normalize the live Clan Wars season/week/day clock;
- send the result to `elixir-drop-cr-results`, then delete the request; and
- post compact, best-effort Elixir Drop Discord events when the bridge starts or
  restarts and after a player queue round-trip is safely complete.

SQS visibility and dead-letter queues provide retries. The result Lambda is
idempotent and ignores an older response when a newer refresh has already been
requested. Neither Lambda nor the browser receives the CR token.
War-clock refreshes are bridge-driven rather than player-driven, so the season
continues advancing even when nobody logs in. Set `CR_WAR_CLOCK_CLAN_TAG` to a
stable clan visible to the API; it defaults to POAP KINGS (`#J2RGCRVG`).

Commands from the repository root:

```bash
npm run verify --workspace=@elixir-drop/cr-api-bridge
npm run start:once --workspace=@elixir-drop/cr-api-bridge
npm run install:launchd --workspace=@elixir-drop/cr-api-bridge
```

The launchd installer builds the worker, writes
`~/Library/LaunchAgents/com.poapkings.elixir-drop-cr-bridge.plist`, and keeps the
process alive on the required Node 24 runtime. Logs go to
`~/Library/Logs/elixir-drop-cr-bridge.log`.
The worker publishes a one-minute process heartbeat and a separate successful
war-clock heartbeat. Production alarms notify `ELIXIR_DROP_ALARM_EMAIL` if the
process stops, no clock reaches AWS for fifteen minutes, requests back up, or a
request/result reaches a dead-letter queue.

The existing static card-snapshot refresher remains in
`apps/web/scripts/refresh-cards.mjs`. Moving or replacing that maintenance path is
a separate migration decision.
