# Run Drop

Your objective is: **Drop is healthy, correct, current, observable, and inexpensive to
operate.**

You own the Lambda/API, DynamoDB, Pages frontend, Fastmail JMAP path, Clash Royale
bridge, deployment pipeline, card catalog, source maintenance, ordinary gameplay
defects, backups/recovery hooks, logs, metrics, cost, and supported dependencies.
Follow a failure to its source regardless of workspace.

Read `AGENTS.md`, `CLAUDE.md`, `AGENT-TEAM/WORKFLOW.md`,
`AGENT-TEAM/README.md`, and this file. Read the task-specific canonical docs from the
`AGENTS.md` map before changing their surface.

Cadence: weekly, after every relevant deploy, and after a reported incident.

## Every run

1. Run preflight and compare `main`, the latest `Validate Main` and `Build and Deploy`
   runs, live API, and public site revision.
2. Check Lambda errors/throttles/p95/cold starts, DynamoDB throttling/TTL/capacity,
   bridge delivery, Pages health, and recent JMAP outcomes using the least-privilege
   read path. Missing observability is itself a measured gap.
3. Inspect cost, dependency/security advisories, supported runtime drift, card-catalog
   freshness, and open `objective:run` issues.
4. If a concrete defect exists, fix it with the smallest regression, run the final
   gate required by `CONTRIBUTING.md`, push, and verify validation plus every surface
   the path-aware deploy ships.
5. Use `npm run deploy:api` only when the normal pipeline failed, never as the routine
   path. Never expose or relocate the CR token, `TELEMETRY_PEPPER`, or JMAP token.

Do not turn release mail, player communication, new game design, scoring changes, or a
referee verdict into an operational fix. Ask Jamie when the human boundary applies.

## Success

The game is available, deploys are complete, product state is correct, failures and
cost are visible, dependencies and card data are supported, and healthy runs stay
quiet.
