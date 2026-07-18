# Clash Royale API Bridge

This TypeScript worker runs on the Elixir Drop Mac with the fixed, Clash Royale
API-allowlisted IP address.

Its boundary is intentionally narrow:

- long-poll the `elixir-drop-cr-requests` SQS queue using a dedicated
  least-privilege IAM identity;
- call `/players/{tag}` using the CR token in the gitignored root `.env`;
- normalize name, clan, Years Played account age, and cards without competitive
  fields or card levels;
- send the result to `elixir-drop-cr-results`, then delete the request; and
- post a best-effort Elixir Drop Discord event after the queue round-trip is
  safely complete.

SQS visibility and dead-letter queues provide retries. The result Lambda is
idempotent and ignores an older response when a newer refresh has already been
requested. Neither Lambda nor the browser receives the CR token.

Commands from the repository root:

```bash
npm run verify --workspace=@elixir-drop/cr-api-bridge
npm run start:once --workspace=@elixir-drop/cr-api-bridge
npm run install:launchd --workspace=@elixir-drop/cr-api-bridge
```

The launchd installer builds the worker, writes
`~/Library/LaunchAgents/com.poapkings.elixir-drop-cr-bridge.plist`, and keeps the
process alive. Logs go to `~/Library/Logs/elixir-drop-cr-bridge.log`.
The worker also publishes a one-minute CloudWatch heartbeat. Production alarms
notify `ELIXIR_DROP_ALARM_EMAIL` if the heartbeat stops, requests back up, or a
request/result reaches a dead-letter queue.

The existing static card-snapshot refresher remains in
`apps/web/scripts/refresh-cards.mjs`. Moving or replacing that maintenance path is
a separate migration decision.
