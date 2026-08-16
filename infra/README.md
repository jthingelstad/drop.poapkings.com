# Infrastructure

`template.yaml` provisions the production Elixir Drop API as one CloudFormation
stack:

- arm64 Node.js 24 Lambda with reserved concurrency caps;
- API Gateway HTTP API with default-route throttling and Drop plus the standard
  Vite dev and preview localhost CORS origins — the localhost origins are
  intentional (local development runs against the deployed API with
  bearer-token auth) and the deploy smoke test asserts them;
- DynamoDB on-demand table with point-in-time recovery, encryption, TTL, and a
  seasonal leaderboard index;
- encrypted CR request/result queues with dead-letter queues and an SQS-triggered
  result Lambda for both player snapshots and the Clan Wars clock; and
- a least-purpose Lambda runtime role for DynamoDB, SQS, logs, and Bedrock name
  generation.

The stack also exports a narrowly scoped leaderboard-maintenance role. The
`elixir-drop` deploy user may assume it for explicit data repairs; it can scan
the game table and update only `GSI1PK`/`GSI1SK` on `PLAYER#` items, so it cannot
change canonical runs, scores, profiles, XP, or referee evidence.

The private fixed-host Control Room assumes two other roles. The referee role
remains pseudonymous and writes only `REFEREE#` overlays. The separate
`elixir-drop-control` account-support role can project an explicit allowlist of
profile and Clash snapshot fields (including email) and can only transact an
audited public-profile correction with a `CONTROL#PLAYER#` event. Email is not
in its write allowlist, and magic links, sessions, run/evidence bodies, scores,
XP, deletes, and secrets are outside the role.

The gitignored root `.env` also supplies
`ELIXIR_DROP_DISCORD_WEBHOOK_URL`, `BUTTONDOWN_API_KEY`, and the explicit
`BUTTONDOWN_NEWSLETTER_ID`. `TINYLYTICS_API_TOKEN` optionally enables the API's
authoritative product-event publisher. CloudFormation treats the credentials as `NoEcho`
parameters and exposes them only to the Lambda runtime. Buttondown enrollment
runs only after a player redeems a valid magic link; account deletion removes
the matching subscriber, while Buttondown preserves its own unsubscribe and
suppression states.
CloudWatch separately alarms on the bridge process heartbeat and on successful
five-minute Clan Wars clock relays. The API, result consumer, and daily mail
canary write JSON logs to dedicated 30-day log groups. The canary submits one
message each day through the same Fastmail JMAP path as player magic links and
alarms on both delivery failure and a missing scheduled run. It targets
`drop@poapkings.com` unless `ELIXIR_DROP_CANARY_EMAIL` overrides it, while the
message itself still sends from `elixir@poapkings.com`. Operational alarms also
target `drop@poapkings.com` by default. The recipient parameters are independent
of `ELIXIR_DROP_EMAIL_FROM`, so rotating the magic-link sender cannot silently
retarget administrative mail.

The HTTP API also writes privacy-conscious JSON access logs to the 30-day
`/elixir-drop/api-access` log group. Each record includes the request ID, route
template, response and integration status, response and integration latency,
and response size; it deliberately omits IP addresses, user agents, query
strings, concrete paths, and authorization data. The gateway declares each
application endpoint with a parameterized route template (plus a `$default`
404 fallback), so the access logs and detailed metrics remain route-aware
without recording player IDs. The `elixir-drop-operations` CloudWatch dashboard
puts alarm state, aggregate and per-route request volume and p95 latency, Lambda
health and concurrency, and DynamoDB capacity and failures in one view. The
route charts discover the detailed API Gateway metrics dynamically, so newly
declared routes appear without another dashboard edit. Alarms cover API p95/p99
latency, 80% of the API Lambda's reserved concurrency, DynamoDB throttle events,
and DynamoDB service errors.

`npm run bootstrap:aws` is the one-time setup. It uses the currently configured
administrator credentials to create the `elixir-drop` IAM deploy user, the
queue-only `elixir-drop-cr-bridge` user, a CloudFormation execution role, a
private versioned code bucket, and a mode-0600 gitignored root `.env`. It copies
the existing CR token only into that local file; Lambda and CI never receive it.
Secret values are never printed.

`npm run deploy:api` then uses AWS SDK clients—not the AWS CLI—to build and zip
the TypeScript Lambda, upload it, create or update the stack, and write the
public API endpoint to `apps/web/public/api-config.json`.

## Continuous deployment

Every push to `main` first runs `.github/workflows/validate-main.yml`: a
high-severity `npm audit`, non-browser verification, and—when browser code can
change—the sharded Chromium suite plus the tagged cross-browser deployment
smoke. Validation is safe to cancel when a newer push arrives; the replacement
classifies the cumulative diff since the last successful production run. What
each quality gate contains is documented in `CONTRIBUTING.md`.

A successful validation triggers `.github/workflows/deploy.yml`, which requires
that exact SHA still to be `main` and serializes production work. API/infra-only
changes run `npm run deploy:api` and the API smoke without publishing Pages. Web
and shared-package changes first update the API's referee `WEB_VERSION`, smoke
the API, rebuild against the stack endpoint, and then publish Pages. Test-only,
fixed-host, tooling, and documentation changes stop after validation. This keeps
incompatible web and Lambda versions from reaching production without paying
for an unrelated surface on every commit. A validated SHA superseded while it
waits for the production lock ends as a successful no-op and writes no production
marker, so routine rapid pushes do not produce false failure notifications.

Lambda artifacts use a SHA-256 content key. Re-running an identical bundle does
not invent a new S3 key or force a Lambda publication, and CloudFormation's
"No updates" response is a successful no-op. The website emits an uncached
`version.json`; stale tabs poll that Pages-owned manifest rather than treating
player API reachability as a web-version signal.

GitHub Actions receives only the limited `elixir-drop` IAM deploy-user key through
the `ELIXIR_DROP_AWS_ACCESS_KEY_ID` and `ELIXIR_DROP_AWS_SECRET_ACCESS_KEY`
repository secrets. Region, CloudFormation role, code bucket, and stack name are
repository variables. Fastmail, session-signing, and Discord secrets stay in
CloudFormation: CI updates use the existing `NoEcho` parameter values rather than
copying those application secrets into GitHub. The CI smoke step therefore
reports its Fastmail JMAP probe as "not checked" — live mail verification runs
from the fixed host via `npm run check:beta`. (If a
`ELIXIR_DROP_FASTMAIL_JMAP_TOKEN` repository secret still exists from an earlier
setup, delete it.) Pull requests and the daily exhaustive browser regression run
through `.github/workflows/verify.yml` with no secrets at all — fork-safe by
construction.

The first stack creation and any intentional secret rotation remain local
`npm run deploy:api` operations using the mode-0600 root `.env`.

The GitHub Pages website remains outside this AWS stack. CloudFormation owns the
bridge queues and result consumer; the fixed-IP worker remains a local launchd
service on the allowlisted Mac.
