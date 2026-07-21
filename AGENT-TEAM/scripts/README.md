# Fair Play Referee — read-only scripts

These standalone Node ESM scripts are the **only sanctioned data path** for the
Fair Play Referee (`AGENT-TEAM/fair-play-referee.md`). They encapsulate one
documented DynamoDB query each and print sanitized, annotated JSON. They import
nothing from `services/api` (workspace-boundary rule); the key conventions live
in `_referee-lib.mjs` and are versioned by each evidence item's `schemaVersion`.

Run them from the repository root, e.g.:

```
node AGENT-TEAM/scripts/referee-cohort.mjs --mode surge --scope season
node AGENT-TEAM/scripts/referee-run.mjs <runId>
```

## Credentials (least privilege)

Run under the **read-only** `RefereeReadRole` (defined in `infra/template.yaml`,
ARN exported as `RefereeReadRoleArn`). It grants DynamoDB `GetItem`,
`BatchGetItem`, `Query`, and `Scan` on the table and its indexes — **no write
actions, and no access to any secret**. In particular it has **no** access to
`TELEMETRY_PEPPER` (Lambda-only), so even with table read access the referee
cannot reverse a correlation hash back to an IP.

The scripts use the ambient AWS credential chain, so assume the role first
(e.g. `AWS_PROFILE=referee-read`, or an `sts assume-role` session). Even though
the managed host has broader access, assuming the read-only identity means a
script bug can never write. Configuration:

- `AWS_REGION` (required — fails closed if unset).
- `DROP_TABLE_NAME` / `TABLE_NAME` (optional; default `elixir-drop`).

## Scripts

| Script | Arguments | Returns |
| --- | --- | --- |
| `referee-run.mjs` | `<runId>` | Full annotated evidence for one run (challenge, transcript, timing, recomputed score, scoring version, integrity outcome, correlation hashes). Resolves `runId` by scanning for the `EVIDENCE#` item. |
| `referee-cohort.mjs` | `--mode <m> --scope season\|all-time [--limit 25] [--season <id>]` | Ranked top cohort: `{ rank, playerId, runId, score, completedAt, timeMs? }`. Season defaults to the live Clan Wars season. |
| `referee-player.mjs` | `<playerId>` | Bounded run history + per-mode progression for one pseudonymous player. |
| `referee-tags.mjs` | — | Normalized player-tag clusters: `{ playerTag, accounts: [playerId, …] }`, multi-account tags first. |
| `referee-feed.mjs` | `--since <ISO>` | Cohort entries (season + all-time, every ranked mode) whose run completed after the cursor, newest first. |

## Output contract

Every script prints one JSON object to stdout:

- Success: `{ "status": "ok", … }`, exit `0`.
- Failure: `{ "status": "insufficient_evidence", "reason": "…", "detail"?: "…" }`,
  exit **non-zero**. This is the fail-closed envelope — missing credentials, a
  missing region, a not-found run/player, or a deleted account all produce it.

## What the scripts never emit

By construction (`sanitize` in `_referee-lib.mjs` deep-strips these keys):

- the internal subject key `sub` / `playerSub`,
- any email address,
- a raw IP address or raw user-agent,
- the `TELEMETRY_PEPPER`.

The referee sees only the pseudonymous **`playerId`**, opaque **correlation
hashes**, a coarse **`uaFamily`**, and the **normalized, unverified `playerTag`**.
Player-tag reuse is a signal, never proof of shared ownership.
