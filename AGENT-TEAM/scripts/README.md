# Fair Play Referee — evidence and decision scripts

These standalone Node ESM scripts are the **only sanctioned data and decision
path** for the Fair Play Referee (`AGENT-TEAM/fair-play-referee.md`). Read
scripts encapsulate documented DynamoDB queries and print sanitized, annotated
JSON. `referee-decide.mjs` is the one write path: it stores an independent,
audited visibility decision without editing a run, score, transcript, player, or
leaderboard row. The scripts import nothing from `services/api`
(workspace-boundary rule); key conventions live in `_referee-lib.mjs`.

Run them from the repository root, e.g.:

```
node AGENT-TEAM/scripts/referee-cohort.mjs --mode surge --scope season
node AGENT-TEAM/scripts/referee-run.mjs <runId>
node AGENT-TEAM/scripts/referee-decide.mjs <runId> \
  --disposition review --visibility hidden \
  --reason "Multiple independent timing and transcript signals"
node AGENT-TEAM/scripts/referee-decide.mjs <runId> \
  --disposition clear --visibility visible \
  --reason "Approved after comparison with complete retained evidence"
node AGENT-TEAM/scripts/referee-decide.mjs <runId> \
  --disposition clear --visibility not_ranked \
  --reason "Play appears genuine; candidate score needs product reconciliation"
```

## Credentials (least privilege)

Run under the bounded `RefereeReadRole` (the physical name is retained for host
compatibility; it is defined in `infra/template.yaml` and exported as
`RefereeReadRoleArn`). It grants DynamoDB `GetItem`, `BatchGetItem`, `Query`, and
`Scan` on the game table, plus `PutItem`/`TransactWriteItems` **only when every
target partition begins `REFEREE#`**. It cannot edit `PLAYER#`, `RUN#`,
leaderboard, evidence, profile, XP, or score records and has no access to any
secret. In particular it cannot access `TELEMETRY_PEPPER` (Lambda-only).

The scripts use the ambient AWS credential chain, so assume the role first
(e.g. `AWS_PROFILE=referee-read`, or an `sts assume-role` session). Even though
the managed host has broader access, assuming the bounded identity means a
script bug cannot write outside the referee-owned decision partitions.
Configuration:

- `AWS_REGION` (required — fails closed if unset).
- `DROP_TABLE_NAME` / `TABLE_NAME` (optional; default `elixir-drop`).

## Scripts

| Script                  | Arguments                                                                | Returns                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `referee-run.mjs`       | `<runId>`                                                                | Full annotated evidence for one run (challenge, transcript, timing, recomputed score, scoring version, integrity outcome, correlation hashes). Resolves `runId` by scanning for the `EVIDENCE#` item. |
| `referee-cohort.mjs`    | `--mode <m> --scope season\|all-time [--limit 25] [--season <id>]`       | Ranked top cohort: `{ rank, playerId, runId, score, completedAt, timeMs? }`. Season defaults to the live Clan Wars season.                                                                            |
| `referee-player.mjs`    | `<playerId>`                                                             | Bounded run history + per-mode progression for one pseudonymous player.                                                                                                                               |
| `referee-tags.mjs`      | —                                                                        | Normalized player-tag clusters: `{ playerTag, accounts: [playerId, …] }`, multi-account tags first.                                                                                                   |
| `referee-feed.mjs`      | `--since <ISO>`                                                          | Cohort entries plus unscored attempts completed after the cursor, newest first.                                                                                                                       |
| `referee-decisions.mjs` | `[--disposition <d>] [--visibility visible\|hidden\|not_ranked] [--limit 200]` | Current private judgments for unresolved and changed-case review.                                                                                                                        |
| `referee-decide.mjs`    | `<runId> --disposition <d> --visibility visible\|hidden\|not_ranked --reason <text>` | Atomically writes the current decision and immutable audit event. `hidden` requires `review`; `visible` restores a scored run; `not_ranked` records judgment when no candidate score exists. |

Leaderboard cohort/feed output reconciles current decisions. A hidden seasonal
best falls back to the player's next-best visible run. The all-time cohort does
the same, so hiding one fabricated score does not erase the player's legitimate
history. Legacy all-time rows without a projected `runId` are resolved against
immutable player history and fail closed if no exact earning run exists.
`referee-run` and `referee-player` annotate evidence/history with the current
decision when one exists. The game may seed `review`/`hidden` whenever
an assumption in scoring or integrity flags a run that still has a deterministic
candidate score; `referee-decide.mjs` replaces that current decision with the
referee's evidence-grounded judgment while preserving both events in audit
history. Automatic labels are review signals, never verdicts.

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
