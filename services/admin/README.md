# Drop Control Room

The Control Room is the private, desktop-first operations surface for Elixir
Drop. It runs only on the fixed host, binds to `127.0.0.1`, and is published to
Jamie through Tailscale Serve. It is not part of the public web build and has no
public route.

The center column is a searchable player directory. The wide workspace on the
right holds filterable run history, full retained submission/evidence JSON,
profile and Clash context, badges, referee decisions, and ranked-access state.
Run rows support individual or select-filtered bulk review. The bulk tray uses
the same decision and player-reason vocabulary as the single-run inspector,
requires a second confirmation, caps one request at 200 unique runs, and invokes
`referee-decide.mjs` separately for every run. Successful and failed items are
reported independently; failed items remain selected for correction or retry.
Practice rows are intentionally not selectable because no referee evidence is
retained for them.

Two deliberately separate AWS capabilities feed it:

- Referee evidence, run decisions, and ranked access always invoke the
  sanctioned `AGENT-TEAM` scripts under `referee-read`, preserving their
  pseudonymous output, validation, immutable decision history, and reversible
  overlays.
- Account details and audited public-profile corrections invoke only
  `services/admin/scripts/control-*.mjs` under `drop-control`. That role may read
  email/profile/CR snapshot fields and atomically update `publicName` plus
  `favoriteCardId` and/or the unverified Clash tag with an immutable `CONTROL#`
  audit event. Email is visible but cannot be edited.

## Local development

Use Node 24 and two terminals:

```sh
DROP_ADMIN_DEV_BYPASS_IDENTITY=1 AWS_PROFILE=referee-read DROP_ADMIN_ACCOUNT_PROFILE=drop-control AWS_REGION=us-east-1 npm run start:admin
npm run dev:admin
```

Build both pieces with `npm run build:admin`. Install or refresh the fixed-host
launch agent with `npm run install:admin`. The service defaults to port `8780`;
the Vite dev server on `8781` proxies `/api` to it.

The managed host's AWS config keeps the capabilities visibly separate:

```ini
[profile drop-control]
role_arn = arn:aws:iam::<account>:role/elixir-drop-control
source_profile = elixir-drop-source
role_session_name = elixir-drop-control-room
region = us-east-1
```

## Security boundary

- The service refuses non-loopback binds.
- Production requires the exact `Tailscale-User-Login` configured in
  `DROP_ADMIN_ALLOWED_LOGIN` (default `jthingelstad@github`).
- State-changing requests require a process-random CSRF token and same-origin
  `Origin`/`Referer` proof.
- CSP denies third-party connections, embedding, and remote assets.
- The launch agent uses `AWS_PROFILE=referee-read` for referee actions and sets
  `DROP_ADMIN_ACCOUNT_PROFILE=drop-control` only for the account-support child
  scripts. The referee response still contains no email or raw subject.
- The account role is projection- and attribute-bounded. It cannot read magic
  links, poll sessions, referee evidence, runs, or secrets; cannot change email,
  XP, scores, or history; and has no delete action.
- Run evidence includes the exact retained transcript. Signed run tokens,
  authorization, raw account subjects, IP addresses, raw user agents, and the
  telemetry pepper never enter the browser response.
- Its explicit `PATH` includes the installed Node 24 directory so the AWS
  profile's credential process works in launchd's otherwise minimal environment.
- Private rationales remain in referee partitions and never become public
  player copy. Player-visible exclusion language continues to come from the
  approved categorical reason codes in the public API.

Tailscale Serve is deliberately configured outside the repository because its
state belongs to the fixed host. Verify `tailscale serve status --json` after
installation and ensure the selected HTTPS listener is absent from
`AllowFunnel` before calling the Control Room private.
