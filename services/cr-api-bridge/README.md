# Clash Royale API Bridge

This workspace is reserved for the process that will run on a managed host with
the fixed, Clash Royale API-allowlisted IP address.

Its expected boundary is intentionally narrow:

- receive work asynchronously from the Elixir Drop backend;
- call the Clash Royale API from the allowlisted host; and
- return results to AWS for backend consumption.

The queue provider, request and response envelopes, retry behavior, credentials,
and process supervision model are not designed yet. Do not couple Lambda code to
the Clash Royale API or place the Clash Royale token in AWS while those decisions
remain open.

When implementation begins, this workspace should gain its own build, test, and
`verify` scripts so the root workspace gate includes it automatically.

The existing static card-snapshot refresher remains in
`apps/web/scripts/refresh-cards.mjs`. Moving or replacing that maintenance path is
a separate migration decision.
