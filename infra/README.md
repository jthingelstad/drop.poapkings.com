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

The gitignored root `.env` also supplies
`ELIXIR_DROP_DISCORD_WEBHOOK_URL`. CloudFormation treats it as a `NoEcho`
parameter and exposes it only to the Lambda runtime for notable event delivery.
CloudWatch separately alarms on the bridge process heartbeat and on successful
five-minute Clan Wars clock relays. The API, result consumer, and daily mail
canary write JSON logs to dedicated 30-day log groups. The canary submits one
message each day through the same Fastmail JMAP path as player magic links and
alarms on both delivery failure and a missing scheduled run. It targets
`elixir@poapkings.com` unless `ELIXIR_DROP_CANARY_EMAIL` overrides it.

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

Every push to `main` runs the complete repository verification, deploys the API,
and only then publishes the matching website build to GitHub Pages. A failed API
deployment blocks the website deployment, preventing incompatible web and Lambda
versions from reaching production.

GitHub Actions receives only the limited `elixir-drop` IAM deploy-user key through
the `ELIXIR_DROP_AWS_ACCESS_KEY_ID` and `ELIXIR_DROP_AWS_SECRET_ACCESS_KEY`
repository secrets. Region, CloudFormation role, code bucket, and stack name are
repository variables. Fastmail, session-signing, and Discord secrets stay in
CloudFormation: CI updates use the existing `NoEcho` parameter values rather than
copying those application secrets into GitHub. The CI smoke step therefore
reports its Fastmail JMAP probe as "not checked" — live mail verification runs
from the fixed host via `npm run check:beta`. (If a
`ELIXIR_DROP_FASTMAIL_JMAP_TOKEN` repository secret still exists from an earlier
setup, delete it.) Pull requests run the same `npm run verify` gate through
`.github/workflows/verify.yml` with no secrets at all.

The first stack creation and any intentional secret rotation remain local
`npm run deploy:api` operations using the mode-0600 root `.env`.

The GitHub Pages website remains outside this AWS stack. CloudFormation owns the
bridge queues and result consumer; the fixed-IP worker remains a local launchd
service on the allowlisted Mac.
