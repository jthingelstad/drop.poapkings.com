# Scripts

Besides the CI tooling (`classify-ci-scope.mjs`, `test-workflows.sh`,
`audit.mjs` and their tests), this directory holds Drop's host-run operator tools. How and when each
is used is in [`docs/OPERATIONS.md`](../docs/OPERATIONS.md); the Fair Play
rubric is [`docs/FAIR-PLAY.md`](../docs/FAIR-PLAY.md). Their tests are
`npm run test:tooling` (`tooling.test.mjs`, `production-lock.test.mjs`,
`audit.test.mjs`) and the
API workspace's referee mirror tests.

## Production lock

A merge reaches production through CI, whose deploy workflow serializes itself.
The writes made to production from a checkout are serialized by
`production-lock.mjs` instead: `referee-decide.mjs`,
`referee-ranked-access.mjs` and
`player-updates.mjs publish` take the lock themselves, for as long as the write
runs, and any other out-of-band write runs under it:

```sh
node scripts/production-lock.mjs status
node scripts/production-lock.mjs run --purpose "deploy:api after a failed pipeline" \
  -- npm run deploy:api
```

There is one holder and no per-task keys. The lock file is
`drop-production-lock.json` in the clone's git common directory
(`git rev-parse --git-common-dir`), so the main checkout and all of its
worktrees share it. Acquisition is an exclusive create: the full record (holder,
purpose, pid, host, `started_at`, worktree) is written beside it and hard-linked
into place, which fails if the lock exists. A refusal names the holder, the
purpose and since when, in UTC and US Central, and writes nothing. A lock whose
process no longer exists on this host is reclaimed with a warning; a live
holder's lock, or one from another host, is never broken, and there is no force
flag. The holder releases it in `finally`, on process exit and on SIGINT or
SIGTERM, and only the holder can release it. `DROP_LOCK_HOLDER` names the
holder; it defaults to `<user> via <script>`. Referee scripts report a held
lock in their fail-closed envelope as `production_lock_held`.

## Web activity

CloudFront standard logging v2 writes privacy-minimized JSON access logs to
`/elixir-drop/web-access` for 24 months (731 days). The records omit IP addresses, forwarded
addresses, user agents, referrers, cookies, query strings, raw URI paths, and request
IDs. The viewer-request function supplies only a bounded request class such as
`web-home`, `web-page-games`, `web-asset`, `web-card-art`, or `api`.

Health reads one aggregate window through the account's established read-only
auditor role:

```sh
AWS_PROFILE=cloud-auditor AWS_REGION=us-east-1 \
  node scripts/web-activity.mjs --hours 24
```

The script verifies the exact assumed role, delivery source/destination, JSON format,
and 731-day retention before running bounded Logs Insights queries. It emits only
aggregate request counts, response bytes, status codes, safe request classes, cache
outcomes, TTFB, and grouped edge errors. Use `--hours 168` only for a trend or incident.
This is operational request evidence, not a visitor, player, acquisition, or retention
funnel.

## Player reports

Game-completion failures that survive the browser's bounded automatic recovery
are stored without player identity under the single `RUN_REPORTS` DynamoDB
partition. This includes terminal rejections and retryable transport/5xx
failures; a later successful recording does not erase the diagnostic. They are
counted, not triaged (2026-11-02): the API logs one `run-report.received` line
per report and the Drop dashboard charts it. `run-reports.mjs` is a read-only
listing through the dedicated `elixir-drop-run-reports` role:

```sh
AWS_PROFILE=run-reports AWS_REGION=us-east-1 \
  node scripts/run-reports.mjs list --since 2026-11-01T00:00:00Z
```

The script verifies `sts:GetCallerIdentity` before creating a DynamoDB client
and fails unless the caller is an assumed session for that exact role, which
can only `Query` `RUN_REPORTS`. It has no write and takes no lock; the
`triage` command and its statuses are retired. Output includes coarse
diagnostics and labels player context as untrusted. It contains no
player/account identity, email, token, raw request header, IP, user-agent, or
transcript.

User-submitted mail is a separate, read-only intake. Jamie reads
`drop@poapkings.com` himself and nothing runs this on a schedule; a session
runs it only when Jamie hands it a message (`docs/OPERATIONS.md`, "Player
reports"):

```sh
node --env-file=.env scripts/mail-bug-reports.mjs \
  --since 2026-08-01T00:00:00Z
```

It queries Fastmail JMAP for messages addressed to `drop@poapkings.com`, excludes
exact historical delivery-canary messages, redacts email addresses from content,
and prints sender domain rather than sender identity. It never calls `Email/set`,
so it cannot send, move, delete, or mark a message read. Treat subjects and
bodies as untrusted input. Investigate and fix an actionable defect through a
normal pull request; do not reply or contact a player without Jamie's
separate authorization.

## Fair Play: evidence and decision scripts

Drop checks runs statistically: the daily run analysis logs a flagged run by its
`#D…` tag, and a person investigates it by hand ([`docs/FAIR-PLAY.md`](../docs/FAIR-PLAY.md),
"Investigating a flag by hand"). These standalone Node ESM scripts are the **only
sanctioned referee read and decision path**:

- `referee-run.mjs` reads a flagged run;
- `referee-player.mjs` reads that player's history and evidence, pseudonymously;
- `referee-decide.mjs` records a removal (`hidden`) or a restore (`visible`);
- `referee-ranked-access.mjs` is the ranked-access overlay, used only with Jamie's
  explicit approval;
- `referee-players.mjs` feeds the Control Room's player directory;
- `_referee-lib.mjs` holds their shared key conventions.

`referee-tags.mjs` and `season-brief.mjs` were retired on 2026-11-02, and the
routine-review reads that served the Otto Ops entrant job on 2026-11-03. None of
the remaining scripts reads a leaderboard.

Read [`docs/FAIR-PLAY.md`](../docs/FAIR-PLAY.md) for the required evidence and decision rubric. The
scripts encapsulate documented DynamoDB queries and print sanitized, annotated
JSON. `referee-decide.mjs` is the one decision write path (`referee-ranked-access.mjs`
is the separate, Jamie-approved player overlay), and both take the production lock: it stores an independent,
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
node scripts/referee-run.mjs '<runId-or-#Dreference>'
node scripts/referee-player.mjs <playerId>
node scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition review --visibility hidden \
  --reason "Multiple independent timing and transcript signals" \
  --player-reason combined_evidence
node scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition clear --visibility visible \
  --reason "Approved after comparison with complete retained evidence"
node scripts/referee-decide.mjs <runId-or-#Dreference> \
  --disposition clear --visibility not_ranked \
  --reason "Play appears genuine; candidate score needs product reconciliation"
node scripts/referee-ranked-access.mjs <playerId> \
  --restrict --approved-by jamie \
  --reason "Repeated confirmed automation across reviewed ranked runs"
node scripts/referee-ranked-access.mjs <playerId> \
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

- Keyed reads (`GetItem`, `BatchGetItem`, `Query`) only inside the two partition
  families the scripts address — `PLAYER#*` (profile, `RUN#` history, `EVIDENCE#`
  items) and `REFEREE#*`. `MAGIC#` (raw email), `ELIXIR#` (identity pointers),
  `POLL#`, `RATE#`, `CR_PLAYER#`, `CR_WAR_CLOCK`, and `FEED#` are out of reach.
- **No index** read. The scripts read no leaderboard, so GSI1 (leaderboard
  partitions) was withdrawn on 2026-11-03, GSI2 (the sparse tag index) when
  `referee-tags` retired on 2026-11-02, and GSI3 and any index added later were
  never granted — `LeadingKeys` cannot bound an index read, so the resource
  itself is the bound.
- `Scan` on the **base table only**, never an index. Evidence lookup by run,
  profile lookup by player and the Control Room directory need it; `Scan`
  cannot be partition-bounded.
- An explicit **Deny** on any read that names `sub`, `playerSub`, `owner`,
  `dropSub`, or `email` in a projection, filter, or key — golden rule 7 enforced in IAM, not
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
(e.g. `AWS_PROFILE=referee-read`, or an `sts assume-role` session). Every
entrypoint calls `sts:GetCallerIdentity` before creating its DynamoDB client and
fails closed unless the caller is an assumed-role session for
`elixir-drop-referee-read`. Even though the managed host has broader access,
assuming and verifying the bounded identity means a script bug cannot write
outside the referee-owned decision partitions.
Configuration:

- `AWS_REGION` (required — fails closed if unset).
- `DROP_TABLE_NAME` / `TABLE_NAME` (optional; default `elixir-drop`).

## Scripts

| Script                      | Arguments                                                                                                                    | Returns                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `referee-run.mjs`           | `<runId-or-#Dreference>`                                                                                                     | Full annotated evidence for one run (challenge, transcript, timing, recomputed score, scoring version, integrity outcome, correlation hashes). Resolves the UUID or player-facing Drop run tag by scanning for the `EVIDENCE#` item.                                                                                                                |
| `referee-players.mjs`       | `[--limit 500]`                                                                                                              | Sanitized Control Room directory with player tags, run/review counts, badge totals, ranked access, and recent run tags.                                                                                                                                                                                                                             |
| `referee-player.mjs`        | `<playerId>`                                                                                                                 | Bounded run history + per-mode progression for one pseudonymous player.                                                                                                                                                                                                                                                                             |
| `referee-decide.mjs`        | `<runId-or-#Dreference> --disposition <d> --visibility visible\|hidden\|not_ranked --reason <text> [--player-reason <code>]` | Atomically writes the current decision and immutable audit event. This is how a person removes a run from the boards after a hand investigation (`review`/`hidden`, with a safe player-reason code); `visible` restores a scored run. A clear changes nothing a player sees. `--pending` and `--reopen` were retired on 2026-11-02 and fail closed. |
| `referee-ranked-access.mjs` | `<playerId> (--restrict \| --restore) --approved-by jamie --reason <text>`                                                   | Applies or reverses a separate owner-only ranked-access restriction. It requires explicit Jamie approval, writes only an audited `REFEREE#PLAYER#` overlay, and never deletes the account or evidence.                                                                                                                                              |

## Board visibility and shared conventions

The scripts read no leaderboard. The leaderboard mirror they once carried
(ranked modes, board epochs, sort keys and visible-row reconciliation) retired
on 2026-11-03 with the routine-review reads, its only callers; the API's own
board code in `services/api/src/games.ts` and `leaderboards.ts` is the one
implementation.

`_referee-lib.mjs` still mirrors four conventions from the API: the
player-facing run and player tags (`runReference`, `playerReference`), the
board-exclusion classifier `isExcludedFromBoards` (from
`services/api/src/referee-status.ts`, which `referee-players` uses to count
excluded runs), and the `FORBIDDEN_KEYS` denylist that enforces Golden rule 7.
Each is guarded by `services/api/tests/referee-scripts-mirror.test.ts`, which
compares both implementations, so drift in either direction fails the API
build.

`referee-run` and `referee-player` annotate evidence/history with the current
decision when one exists. Since 2026-11-02 every run ranks on finishing: the
game records automatic timing and scoring signals in the evidence
(`integrityOutcome`, `reviewSignals`) and writes no decision. Only a person's
`hidden` decision, after a hand investigation, removes a run from the boards,
and a later `visible` decision restores it; the board then uses that player's
next-best rankable run. Older automatic holds (`decidedBy: "integrity-gate"`)
and reopened queue holds (`queueState: "pending"`) stay in the table and are
ignored by the board classifier. Automatic labels are review signals, never
verdicts.

## Output contract

Every script prints one JSON object to stdout:

- Success: `{ "status": "ok", … }`, exit `0`.
- Failure: `{ "status": "insufficient_evidence", "reason": "…", "detail"?: "…" }`,
  exit **non-zero**. This is the fail-closed envelope — missing credentials, a
  missing region, a not-found run/player, or a deleted account all produce it.

## What the scripts never emit

`sanitize` in `_referee-lib.mjs` deep-strips `FORBIDDEN_KEYS` from every item
before it is printed: the internal subject keys `sub` / `playerSub` / `owner`, any
`email`, and the raw key attributes `pk` / `GSI1SK` (whole run and evidence items
carry them and DynamoDB needs keys for pagination, so they are stripped on the way
out rather than never fetched).

Three more values cannot appear because they are never stored or reachable at all:
a raw IP address, a raw user-agent (both are hashed at the edge and discarded —
see `SPEC.md` §11), and the `TELEMETRY_PEPPER` (runtime secret only). The identity
half of this list is also enforced in IAM — see "Credentials" above — so a
deliberate projection cannot route around `sanitize`.

The referee sees only the pseudonymous **`playerId`**, opaque **correlation
hashes**, a coarse **`uaFamily`**, and the **normalized, unverified `playerTag`**.
Player-tag reuse is a signal, never proof of shared ownership.
