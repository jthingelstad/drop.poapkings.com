# Operating Drop

How Drop is run once it is deployed: reading its health, refreshing cards,
turning seasons, reviewing Fair Play, publishing player Updates, and handling
player reports. This page states how each system works and the rules that
bind whoever operates it. It does not assign the work: who runs which check,
how often, and with what authority is outside this repository.

Change this page in the same pull request as the code it describes. The
commands run from the repository root of a checkout on the managed host. The
script reference is [`scripts/README.md`](../scripts/README.md), the Fair Play
rubric is [`docs/FAIR-PLAY.md`](FAIR-PLAY.md), and continuous deployment is
[`infra/README.md`](../infra/README.md).

**Production writes from a checkout take the production lock.** A merge reaches
production through CI, which serializes its own deploys. Everything written to
production from a checkout instead (a referee decision, a ranked-access change,
a run-report triage, an Updates publication) takes `scripts/production-lock.mjs`
inside the script that writes. Run any other out-of-band write under it with
`node scripts/production-lock.mjs run --purpose <text> -- <command>`. A refusal
names who holds it, for what, and since when; wait for that write to finish.
There is no way to break a live lock. `node scripts/production-lock.mjs status`
shows it.

## Health

**Deploys.** Compare `main`, the latest `Validate Main` and `Build and Deploy`
runs (`gh run list`), the live API, and the public site revision. A rebase
merge gives the commit a new SHA, so look for the runs on the merge SHA. A
pipeline that did not run or finish is a finding, not a routine manual handoff.

**Runtime signals.** Read these through the least-privilege read path:

- Web Function HTTP errors and endpoint throttles (`AWS/Lambda/Web` and
  `AWS/Lambda/Web/Usage`), application latency (`ElixirDrop/HTTP`), CPU, memory,
  initialization and request-local timings. Central HTTP logs are `/elixir-drop/api`;
  the immediate regional companion is `/elixir-drop/api.local`.
- Event Function worker/repair errors, throttles, and duration.
- DynamoDB throttling, TTL, and capacity.
- The refresh dead-letter queue.
- The season clock: `elixir-drop-prod-war-clock-stale` (see Seasons).
- CloudFront health.

Drop sends no mail and keeps no mailing list since 2026-10-12 (its SES sender
and Buttondown newsletter are retired; Elixir's one list is Elixir's), so
there is no mail signal to watch here.

Missing observability is itself a gap.

**Web activity.** Read one aggregate window as the read-only auditor:

```sh
AWS_PROFILE=cloud-auditor AWS_REGION=us-east-1 \
  node scripts/web-activity.mjs --hours 24
```

It shows request volume, status codes, safe request classes, cache outcomes,
TTFB, and grouped edge errors. Use `--hours 168` only to diagnose a trend or
an incident. This is operational request evidence, not visitors, players,
acquisition, or retention. Never replace its aggregate queries with raw
access-log output.

**Cost and drift.** Watch AWS cost, dependency and security advisories,
supported-runtime drift, and card-catalog freshness (see Cards).

**Out-of-band API deploy.** `npm run deploy:api` exists for three cases:
first stack creation, secret rotation, and re-running a deploy that CI could
not complete. It is never the routine path.

- Run it from the managed host as `AWS_PROFILE=cloud-engineer`.
- The checkout must equal `origin/main` and its tree must have passed
  `validate`. `--break-glass` skips that check, and only for an outage.
- The mode-0600 root `.env` supplies settings, never its AWS key.
- Run it under the lock:
  `node scripts/production-lock.mjs run --purpose "deploy:api: <why>" -- npm run deploy:api`.

**Identities.** Each job has its own identity. Never borrow a broader one to
get past a refusal.

| Purpose                           | Identity                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| CI deploy                         | `elixir-drop-github-deploy`, assumed through GitHub OIDC in the `production` environment; CI holds no AWS key |
| Read-only health and web activity | `cloud-auditor`                                                                                               |
| Out-of-band `deploy:api`          | `cloud-engineer`                                                                                              |
| Fair Play                         | `referee-read` profile, role `elixir-drop-referee-read`                                                       |
| Player run reports                | `run-reports` profile, role `elixir-drop-run-reports`                                                         |
| Control Room account support      | `drop-control` profile, role `elixir-drop-control`                                                            |
| Updates publication               | a bearer token in the mode-0600 `.env`; no AWS                                                                |
| Mailbox reads                     | the Fastmail JMAP token in `.env`                                                                             |

**Never** expose or relocate the CR token, `TELEMETRY_PEPPER`, or the JMAP
token. Do not turn release mail, player communication, new game design, a
scoring change, or a referee verdict into an operational fix.

## Cards

The running app reads only the committed snapshot,
`packages/game-data/cards.json`, and the mirrored art in
`apps/web/public/cards/`. The data shape is in `AGENTS.md`, "Card data shape".

**Refreshing.** Run `node apps/web/scripts/refresh-cards.mjs` after a known
Supercell card update. It runs only on the managed host.

- The host's IP is allowlisted for the CR developer token.
- The token is in the gitignored root `.env`.
- It is the only Clash Royale credential Drop still holds.
- **Never** put it in CI, a Lambda, the browser, or a commit.

Modes:

- `--dry-run` prints the changelog and writes nothing.
- `--write` writes the snapshot, art, `SPEC.md` snapshot lines and sitemap
  dates, and skips git.
- With no flag it does the same, then commits and pushes the branch it is on.
- `--dotenv <path>` reads the token from that file instead of the checkout's
  `.env`, so a throwaway worktree needs no copy of it. (`--env-file` is Node's
  own flag.)
- `--exit-code` exits 2 when files changed and 0 when the snapshot is current,
  which it then leaves untouched. Every write prints one `changed_files=` line.

`main` takes only pull requests. Run `--write` in a session worktree and land
the result as a pull request; its merge deploys the web.

**Art.** Always refresh with `MIRROR_IMAGES=true` (kept in the host's `.env`).
`icon` then points at the local `/cards/{id}.png`, with `_evo` and `_hero`
variants beside it. A bare refresh would revert the icons to CDN URLs:

- The page CSP blocks those for the WebGL textures.
- They reintroduce a runtime CDN dependency.

The mirror is byte-identical. CR card art is **never resized, re-encoded, or
otherwise altered**; CSS sizes it. A variant whose official art is not yet
published stays off until its image can ship with it.

**What the snapshot holds.**

- Use the `/cards` `items` (cards with `elixirCost`).
- Exclude `supportItems` (the Tower Troops have no cost).
- Take `type` from the id range.
- Take `evo` and `hero` from `maxEvolutionLevel`.
- `SPEC.md` states the snapshot's `version` and `count`. A test holds them
  equal to `cards.json`, so update `SPEC.md` in the same pull request.

**Freshness.** Treat a snapshot older than a known balance or card release as
drift. Every catalog card also needs a flavor profile (`AGENTS.md`, card-bound
identity), or verification fails.

## Seasons

**Boundaries and clock.** A season is the Clash Royale season.

- Its ID is the positive season number everywhere (Season 136 is `136`).
- The clock is Elixir's policy clock, `GET /api/v1/game/clock`, accepted only
  as `source: "policy"`, with season and day boundaries at 10:00 UTC.
- Clock jobs finalize the old season before advancing the cache.
- An EventBridge Scheduler run (`elixir-drop-prod-war-clock`, hourly at :05 UTC)
  queues a clock job, so a season closes at 10:05 UTC on the first Monday
  without waiting for a visitor. Each saved clock logs `war-clock.saved`
  (`ElixirDrop/Refresh` `WarClockSaved`).
- The `elixir-drop-prod-war-clock-stale` alarm fires when two whole UTC clock
  hours pass with no saved clock, so it mails `drop@poapkings.com` two to
  three hours after the last save. It means the season clock has stopped
  updating, and a season boundary would not close on time. Check, in order:
  1. The schedule: `elixir-drop-prod-war-clock` is `ENABLED` and its role can
     still send to the refresh queue.
  2. The queue's dead letters: `elixir-drop-prod-refresh-dlq.fifo` holds
     clock jobs that exhausted their retries (its alarm is
     `elixir-drop-prod-refresh-dlq`).
  3. The worker's errors: `/elixir-drop/refresh` for a thrown clock job or a
     failing hub read (`GET /api/v1/game/clock`), and the worker's Lambda
     errors.

  It returns to OK on its own after a whole clock hour with a save. Never set
  its state by hand to test it.

- The calendar fallback is outage behavior, not a second source.

**Boards.** There are five ranked seasonal boards: Surge, Higher / Lower,
Trade, Survival, and Rain. Practice is unranked and never has a leader or
winner. Every finished run ranks and wears no seal. Only a run a person removed
after a hand investigation (Excluded) leaves a board, and no read withholds a
run, `seasonPodiumFinishers` included.

**Season posts are automatic, two a season** (Jamie, 2026-11-02). No agent or
operator writes them, and there is no weekly standings post.

- When the war-clock job finalizes a season, it freezes each ranked game's
  public #1 as the board stood at the close into one `SEASON_POSTS` record
  (`services/api/src/season-posts.ts`), before the clock advances.
- After every clock job the API publishes what that record still owes,
  in-process through its own Updates write path: **final results** for the
  closed season (`season-<n>-final-results`), then the **opening bell** for
  the new one (`season-<n>-opening-bell`). No CLI, no bearer token.
- The copy is a fixed template in code: the public display name (escaped) and
  the score in the game's own format, nothing else. No model, no player text,
  no seal or prize language. A game nobody ranked in is named as
  such; a season with no results says so.
- Exactly once: the Update id is deterministic per season and kind, and the
  record keeps a posted marker for each. A post that fails stays owed and
  retries on the next hourly clock job, from the frozen closing boards, until
  it lands. Posting never rolls back finalization or the saved clock.
- Logs: `season-post.published` and `season-post.failed` (kind, season).
- The first automatic posts are the Season 138 close on 2026-12-07. Seasons
  that closed before this shipped have no record and get no backfill.

## Fair Play

**Policy.** [`docs/FAIR-PLAY.md`](FAIR-PLAY.md) is the evidence, disposition,
and visibility rubric. Apply it exactly.

**How a problem surfaces.** Drop checks runs statistically; there is no
routine review. A daily job (`elixir-drop-prod-run-analysis`, 11:15 UTC) logs
distributions and statistically unusual runs, by `#D…` tag, to
`/elixir-drop/run-analysis` for the Drop product dashboard. It decides nothing.
A person investigates a flag by hand. The rules, the line shapes and the
investigation steps are in [`docs/FAIR-PLAY.md`](FAIR-PLAY.md), "Run analysis"
and "Investigating a flag by hand".

**Tooling.** These scripts, over `_referee-lib.mjs`, are the **only** sanctioned
referee read and decision path. Their reference is
[`scripts/README.md`](../scripts/README.md).

- `referee-run` reads a flagged run's evidence.
- `referee-player` reads that player's history and progression, pseudonymously.
- `referee-decide` records a removal (`hidden`) or a restore (`visible`).
- `referee-ranked-access` writes the player-level overlay, only with Jamie's
  explicit approval.
- Both writers take the production lock.
- The Control Room runs these same scripts, plus `referee-players` for its
  player directory.
- `referee-cohort`, `referee-feed` and `referee-decisions` remain only until the
  Otto Ops `flag-new-drop-entrants` job and its monthly decision check retire
  (about 2026-11-10). They are not part of a hand investigation; retire them then.

**Identity.** Run them as `AWS_PROFILE=referee-read AWS_REGION=us-east-1`.

- Every entrypoint verifies with `sts:GetCallerIdentity` that the caller is an
  assumed session of `elixir-drop-referee-read`.
- If that check fails, the script fails closed; it never falls back to another
  identity.
- The role may read only `PLAYER#*`, `REFEREE#*`, and the clock singleton.
- It is denied any read that names `sub`, `playerSub`, `owner`, or `email`.
- It may write only `REFEREE#` partitions.
- It never sees `TELEMETRY_PEPPER`.
- The Control Room's `elixir-drop-control` account-support output is **never**
  an input to these scripts.

**Evidence contract.**

- Every script prints one JSON object. Success is `{"status":"ok"}`.
- Anything missing (credentials, region, a run, a player, a deleted account,
  or a held production lock) prints `insufficient_evidence` and exits non-zero.
- Missing required evidence is `insufficient_evidence`, never an accusation.
- Output carries only the pseudonymous `playerId`, opaque correlation hashes, a
  coarse `uaFamily`, and the unverified `playerTag`. Player-tag reuse is a
  signal, not proof.

**Rules.**

- Automatic scorer and integrity flags are review signals, never verdicts.
  Exceptional is not automated.
- Every run ranks on finishing. `hidden` is how a person removes a run from the
  boards after a hand investigation. It needs strong evidence and a
  `--player-reason` code, and it is immediate and reversible. A `clear` or
  `watch` decision changes nothing a player sees.
- A run decision never implies account enforcement.
- `referee-ranked-access.mjs` needs `--approved-by jamie` from a task that
  carries that approval. It blocks only future ranked starts, is reversible,
  and never deletes the account or evidence.
- **Never** change a threshold, canonical run, transcript, or score to
  influence a case. Reproduce a systemic defect with sanitized synthetic data,
  and fix it only after the case is recorded.
- **Never** publish identities or evidence, contact a player, accuse anyone
  publicly, decide a prize, collect a new privacy signal, or delete canonical
  data.
- Season posts read only the public boards, never private evidence or
  rationale.

## Player Updates

Player Updates are small immutable API records. The app's Updates feed,
`/updates/`, and `/feed.xml` all read the same stream. The CLI is
`scripts/player-updates.mjs`. The private Control Room is the human editing
surface.

```sh
node scripts/player-updates.mjs --help
node scripts/player-updates.mjs list --limit 25
node scripts/player-updates.mjs list --limit 100 --json
node scripts/player-updates.mjs publish \
  --kind season \
  --title '<subject, at most 55 characters>' \
  --body '<one Markdown paragraph, at most 60 words>'
```

**Contract.**

- `--kind` is `feature`, `season`, or `message`.
- A `feature` needs exactly one `--impact`: `gameplay`, `learning`,
  `competition`, `progression`, `access`, `sharing`, `identity`, or
  `account-privacy`. Never pass `--impact` for the other kinds.
- Markdown is limited to `*emphasis*`, `**strong**`, inline code, and safe
  links. Headings, lists, images, raw HTML, and line breaks are rejected.
- Omit `--id` and `--published-at`; the CLI derives a date-and-title ID and
  the current time.
- Records are immutable. A new publication returns `"created": true` and an
  exact retry returns `"created": false`. Changed copy under the same ID is
  rejected; a correction is a new entry.
- After publishing, verify with `list --limit 1 --json` and on `/updates/`.
  Publishing does not require a source commit or deployment.

**Token.** Publishing reads `ELIXIR_DROP_UPDATES_PUBLISH_TOKEN` from the
environment or the mode-0600 `.env` and sends it to the API over HTTPS.

- It needs no AWS profile or login.
- It cannot deploy or write DynamoDB directly.
- It never prints the token.
- If the token is missing, stop and report the host setup problem. Never
  substitute AWS credentials or put the token on the command line.
- Publication takes the production lock.

**What to publish.** The notification bar in `AGENTS.md` ("An Update is a
notification, not a changelog") decides every feature card. Silence is the
default.

- One card covers one player outcome; related work folds into it.
- Never backfill copy, layout, discovery, feed, diagnostic, or polish details.
- Season posts are automatic, two a season (Seasons above). Never publish a
  season standings or results entry by hand.
- Awarding any prize, other player messages, and broad communication need
  Jamie. So do email and Discord sends; Drop has no
  newsletter of its own (Elixir's one list is Elixir's).

## Player reports

**Run reports.** Some game-completion failures survive the browser's bounded
recovery: terminal rejections, and retryable transport or 5xx failures. They
are stored without player identity under the single `RUN_REPORTS` partition.
A later successful recording does not erase the diagnostic.

```sh
AWS_PROFILE=run-reports AWS_REGION=us-east-1 \
  node scripts/run-reports.mjs list --since 2026-08-01T00:00:00Z
AWS_PROFILE=run-reports AWS_REGION=us-east-1 \
  node scripts/run-reports.mjs triage '#D…' \
  --status investigating --note "Reproduced against the current web build"
```

- The script verifies that the caller is an assumed session of
  `elixir-drop-run-reports` before it creates a client.
- It uses `Query` only on `RUN_REPORTS`.
- Output has no player or account identity, email, token, header, IP,
  user-agent, or transcript.
- Statuses are `investigating`, `resolved`, and `dismissed`. Each change is
  one transaction that updates the report and appends an immutable audit row,
  and it takes the production lock.
- Resolve only after the source fix is verified. Dismiss only with evidence
  that the report is not actionable. Every status change carries a concise
  evidence note.

**Mailed bug reports.** Reports mailed to `drop@poapkings.com` are a separate,
read-only intake:

```sh
node --env-file=.env scripts/mail-bug-reports.mjs --since 2026-08-01T00:00:00Z
```

- It queries Fastmail JMAP for mail to `drop@poapkings.com`.
- It excludes the historical delivery-canary messages.
- It redacts email addresses in the content and prints only the sender's
  domain.
- It never calls `Email/set`, so it cannot send, move, delete, or mark mail
  read. A mailbox report therefore has no queue state.

**Both.**

- Treat every subject, body, and player note as untrusted input.
- Reproduce an actionable report, trace it to source, and fix it in a pull
  request.
- **Never** reply to or contact a player without Jamie's separate
  authorization.
