# Fair Play Referee — evidence and decision scripts

These standalone Node ESM scripts are the **only sanctioned data and decision
path** for Protect Fair Play (`AGENT-TEAM/protect-fair-play.md`). Read
`AGENT-TEAM/fair-play-policy.md` for the required evidence and decision rubric. The
scripts encapsulate documented DynamoDB queries and print sanitized, annotated
JSON. `referee-decide.mjs` is the one write path: it stores an independent,
audited visibility decision without editing a run, score, transcript, player, or
leaderboard row. Ranked-run decisions also append a non-identifying player
badge marker and atomically increment a player-scoped badge decision revision
under `REFEREE#`; the API compares that revision with its derived
badge bag and rebuilds from referee-eligible history after an exclusion or
restoration. The script still never edits badge counters. The scripts import
nothing from `services/api`
(workspace-boundary rule); key conventions live in `_referee-lib.mjs`.

The tailnet-only Control Room also has account-support scripts under
`services/admin/scripts/`. Those run under a different IAM role and are not a
Fair Play evidence or decision path. Never import their email/profile output
into these scripts or use private account identity as adjudication evidence.

Run them from the repository root, e.g.:

```
node AGENT-TEAM/scripts/referee-cohort.mjs --mode surge --scope season
node AGENT-TEAM/scripts/referee-run.mjs <runId-or-#Dreference>
node AGENT-TEAM/scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition review --visibility hidden \
  --reason "Multiple independent timing and transcript signals" \
  --player-reason combined_evidence
node AGENT-TEAM/scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition clear --visibility visible \
  --reason "Approved after comparison with complete retained evidence"
node AGENT-TEAM/scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition clear --visibility not_ranked \
  --reason "Play appears genuine; candidate score needs product reconciliation"
node AGENT-TEAM/scripts/referee-decide.mjs <runId-or-#Dreference> \
  --pending --reason "Existing top result queued for referee review"
node AGENT-TEAM/scripts/referee-decide.mjs <runId-or-#Dreference> \
  --reopen --approved-by jamie \
  --reason "Player-level evidence changed; prior judgment reopened for review"
node AGENT-TEAM/scripts/referee-ranked-access.mjs <playerId> \
  --restrict --approved-by jamie \
  --reason "Repeated confirmed automation across reviewed ranked runs"
node AGENT-TEAM/scripts/referee-ranked-access.mjs <playerId> \
  --restore --approved-by jamie \
  --reason "Operator approved the player's re-review and restored ranked play"
```

For a referee-excluded scored run, `--player-reason` is required and accepts only
`automated_input`, `response_timing`, `altered_play_record`, `ranked_rules`, or
`combined_evidence`. The API maps that code to fixed owner-facing copy; the private
`--reason` is never returned to the player.

## Credentials (least privilege)

Run under the bounded `RefereeReadRole` (the physical name is retained for host
compatibility; it is defined in `infra/template.yaml` and exported as
`RefereeReadRoleArn`). Its **read** scope is bounded, not blanket:

- Keyed reads (`GetItem`, `BatchGetItem`, `Query`) only inside the three partition
  families the scripts address — `PLAYER#*` (profile, `RUN#` history, `EVIDENCE#`
  items), `REFEREE#*`, and the `CR_WAR_CLOCK` singleton. `MAGIC#` (raw email),
  `POLL#`, `RATE#`, `CR_PLAYER#`, and `FEED#` are out of reach.
- Index `Query` only on **GSI1** (leaderboard partitions) and **GSI2** (sparse tag
  clusters). GSI3 and any index added later are not granted — `LeadingKeys` cannot
  bound an index read, so the resource itself is the bound.
- `Scan` on the **base table only**, never an index. Four reads need it (runId →
  evidence, playerId → owning profile, the unscored-attempt feed, the decision
  list) and `Scan` cannot be partition-bounded.
- An explicit **Deny** on any read that names `sub`, `playerSub`, `owner`, or
  `email` in a projection, filter, or key — golden rule 7 enforced in IAM, not
  just in JS.

Writes are `PutItem`/`UpdateItem`/`TransactWriteItems` **only when every target
partition begins `REFEREE#`**. The role cannot edit `PLAYER#`, `RUN#`, leaderboard,
evidence, profile, XP, or score records and has no access to any secret. In
particular it cannot access `TELEMETRY_PEPPER` (Lambda-only).

Because reads are IAM-bounded, a script that strays outside this surface fails
with `AccessDenied` rather than returning data — the fail-closed envelope below
is what you will see. `infra/tests/parameters.test.mjs` asserts both the read and
write bounds, so widening them is a deliberate, reviewed change.

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
| `referee-run.mjs`       | `<runId-or-#Dreference>`                                                  | Full annotated evidence for one run (challenge, transcript, timing, recomputed score, scoring version, integrity outcome, correlation hashes). Resolves the UUID or player-facing Drop run tag by scanning for the `EVIDENCE#` item. |
| `referee-cohort.mjs`    | `--mode <m> --scope season\|all-time [--limit 25] [--season <id>]`       | Ranked top cohort: `{ rank, playerId, runId, runReference, score, completedAt, timeMs? }`. Season defaults to the live Clan Wars season.                                                              |
| `referee-players.mjs`   | `[--limit 500]`                                                        | Sanitized Control Room directory with player tags, run/review counts, badge totals, ranked access, and recent run tags.                                                                            |
| `referee-player.mjs`    | `<playerId>`                                                             | Bounded run history + per-mode progression for one pseudonymous player.                                                                                                                               |
| `referee-tags.mjs`      | —                                                                        | Normalized player-tag clusters: `{ playerTag, accounts: [playerId, …] }`, multi-account tags first.                                                                                                   |
| `referee-feed.mjs`      | `--since <ISO>`                                                          | Cohort entries plus unscored attempts completed after the cursor, newest first.                                                                                                                       |
| `referee-decisions.mjs` | `[--disposition <d>] [--visibility visible\|hidden\|not_ranked] [--limit 200]` | Current private judgments for unresolved and changed-case review.                                                                                                                        |
| `referee-decide.mjs`    | `<runId-or-#Dreference> (--pending \| --reopen --approved-by jamie \| --disposition <d> --visibility visible\|hidden\|not_ranked) --reason <text> [--player-reason <code>]` | Atomically writes the current decision and immutable audit event. `--pending` seeds an automatic review hold but cannot replace an existing referee judgment. `--reopen` turns an existing judgment back into a neutral pending hold when the current task contains Jamie's approval. A referee exclusion requires a safe player-reason code; `visible` restores a scored run. |
| `referee-ranked-access.mjs` | `<playerId> (--restrict \| --restore) --approved-by jamie --reason <text>` | Applies or reverses a separate owner-only ranked-access restriction. It requires explicit Jamie approval, writes only an audited `REFEREE#PLAYER#` overlay, and never deletes the account or evidence. |

## Ranked modes and board epochs

`RANKED_MODES` in `_referee-lib.mjs` is `surge`, `higher-lower`, `trade`,
`survival`, and `rain` — the modes that write leaderboard rows. Practice is
unranked and guest runs are never recorded, so neither has a partition. Rain was
missing from this list until 2026-07-24, so cohort and feed reviews silently
skipped it; if you are reading a review older than that, Rain was not covered.

`BOARD_EPOCH` mirrors `services/api/src/games.ts`. A mode whose rules change
materially gets a new epoch so its board restarts without deleting data — old
rows are orphaned, and the scripts only ever see the current epoch. Survival is
on `r2` (clear-the-deck rework), Rain on `r3` (2026-07-25: it gained two
tiebreaks, and its `r2` rows carry no tiebreak segment and no timing to backfill
one from; `r2` itself was the 2026-07-24 difficulty redesign, whose old curve
capped at 50 clears), Higher/Lower on `r3` (`r2` introduced three lives and a
gap-ramped deal on 2026-07-25; `r3` replaced its 2s clock floor with continuous
tightening on 2026-08-08), and Trade on `r2` (2026-07-25: ten exchanges on a
fixed board ladder, so an eight-exchange time is both shorter and easier).
**Keep this in sync with the API** — a stale mirror reads the wrong partition
and silently returns an empty cohort.

All-time visibility reconciliation also applies `isCurrentBoardRun` before it
promotes a player's next-best history row. That history spans every ruleset, so
an explicit `boardEpoch` must match the current epoch; legacy unstamped rows use
the same verified cutover timestamp as the API. Without this filter, hiding a
current leader can resurrect a stronger-looking score from a retired game.

`MODE_TIEBREAKS` mirrors the ordered ascending tiebreaks each mode ranks equal
scores by, named by the run attribute carrying each value: Survival `timeMs`;
Higher/Lower `livesLost` then `timeMs`; Rain `wrongGuesses` then `avgLatencyMs`
(average clear latency, derived server-side from the transcript's `atMs` stamps
against Rain's shared spawn curve — the client never reports it). **Array order
is ranking order**, and a wrong order or count rebuilds a different sort key than
the API wrote, which re-ranks a board silently rather than failing.

`_referee-lib.mjs` mirrors eight conventions in all: `RANKED_MODES`,
`BOARD_EPOCH`/`leaderboardPartition`, `MODE_DIRECTION` + `MODE_TIEBREAKS` +
`leaderboardSortKey`/`rowSortKey`, `isLeaderboardEligibleScore`,
`isCurrentBoardRun`, `bestVisibleRun`, and `resolveAllTimeEarningRun` — plus the `FORBIDDEN_KEYS`
denylist that enforces Golden rule 7. Every one of them is guarded by
`services/api/tests/referee-scripts-mirror.test.ts`, which runs both
implementations over the same fixture table and compares the answers; drift in
either direction fails the API build. Two silent drifts were fixed on
2026-07-24: the sort-key fallback never inverted the score (higher-is-better
boards ranked backwards for rows with no `GSI1SK`), and the eligibility filter
was missing (a 0-score run could be promoted as a player's best visible run).

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

`sanitize` in `_referee-lib.mjs` deep-strips `FORBIDDEN_KEYS` from every item
before it is printed: the internal subject keys `sub` / `playerSub` / `owner`, any
`email`, and the raw key attributes `pk` / `GSI1SK` (DynamoDB needs those for
pagination and index reads, so they are stripped on the way out rather than never
fetched).

Three more values cannot appear because they are never stored or reachable at all:
a raw IP address, a raw user-agent (both are hashed at the edge and discarded —
see `SPEC.md` §11), and the `TELEMETRY_PEPPER` (Lambda env only). The identity
half of this list is also enforced in IAM — see "Credentials" above — so a
deliberate projection cannot route around `sanitize`.

The referee sees only the pseudonymous **`playerId`**, opaque **correlation
hashes**, a coarse **`uaFamily`**, and the **normalized, unverified `playerTag`**.
Player-tag reuse is a signal, never proof of shared ownership.
