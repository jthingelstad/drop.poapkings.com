# Drop Control Room

The Control Room is the private, desktop-first operations surface for Elixir
Drop. It runs only on the fixed host, binds to `127.0.0.1`, and is published to
Jamie through Tailscale Serve. It is not part of GitHub Pages and has no public
route.

The UI reads sanitized data exclusively through the existing `AGENT-TEAM`
referee scripts. Decisions and ranked-access changes invoke the sanctioned
scripts rather than writing DynamoDB directly, preserving their immutable audit
events, validation rules, and reversible overlay.

## Local development

Use Node 24 and two terminals:

```sh
DROP_ADMIN_DEV_BYPASS_IDENTITY=1 AWS_PROFILE=referee-read AWS_REGION=us-east-1 npm run start:admin
npm run dev:admin
```

Build both pieces with `npm run build:admin`. Install or refresh the fixed-host
launch agent with `npm run install:admin`. The service defaults to port `8780`;
the Vite dev server on `8781` proxies `/api` to it.

## Security boundary

- The service refuses non-loopback binds.
- Production requires the exact `Tailscale-User-Login` configured in
  `DROP_ADMIN_ALLOWED_LOGIN` (default `jthingelstad@github`).
- State-changing requests require a process-random CSRF token and same-origin
  `Origin`/`Referer` proof.
- CSP denies third-party connections, embedding, and remote assets.
- The launch agent uses `AWS_PROFILE=referee-read`; the role and scripts keep
  email, raw account subjects, IP addresses, raw user agents, and the telemetry
  pepper out of the admin response.
- Private rationales remain in referee partitions and never become public
  player copy. Player-visible exclusion language continues to come from the
  approved categorical reason codes in the public API.

Tailscale Serve is deliberately configured outside the repository because its
state belongs to the fixed host. Verify `tailscale serve status --json` after
installation and ensure the selected HTTPS listener is absent from
`AllowFunnel` before calling the Control Room private.
