# Infrastructure

`template.yaml` provisions the production Elixir Drop API as one CloudFormation
stack:

- arm64 Node.js 24 Lambda;
- API Gateway HTTP API with Drop plus the standard Vite dev and preview localhost CORS origins;
- DynamoDB on-demand table with point-in-time recovery, encryption, TTL, and a
  seasonal leaderboard index; and
- a least-purpose Lambda runtime role for DynamoDB, logs, and Bedrock name
  generation.

`npm run bootstrap:aws` is the one-time setup. It uses the currently configured
administrator credentials to create the `elixir-drop` IAM deploy user, a
CloudFormation execution role, a private versioned code bucket, and a mode-0600
gitignored root `.env`. Secret values are never printed.

`npm run deploy:api` then uses AWS SDK clients—not the AWS CLI—to build and zip
the TypeScript Lambda, upload it, create or update the stack, and write the
public API endpoint to `apps/web/public/api-config.json`.

The GitHub Pages website remains outside this AWS stack. The future CR API bridge
and queue are also deliberately outside this release.
