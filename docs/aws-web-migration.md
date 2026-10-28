# AWS web migration

Elixir Drop moved its static web build from GitHub Pages to the existing AWS
stack on August 22, 2026. DNS remains at the current provider. This is
deliberately a small hobby-project design:

```text
drop.poapkings.com -> CloudFront
  /*       -> private S3 web bucket through origin access control
  /api/*   -> Lambda Web Function (OAC) -> DynamoDB
```

CloudFront runs one viewer-request function. It removes the `/api` prefix
before the HTTP server sees the request and maps `/`, `/games/`, and the other
directory URLs to their generated `index.html` objects. If a client strips
the fragment from a sign-in link, the function redirects the resulting `/auth`
request back to the app's `/#/auth` route with its query intact; the token is
therefore returned to the browser fragment before the app loads and is not sent
to the private S3 origin. API caching is disabled;
static objects follow the cache metadata assigned by `deploy-web.mjs`. Browsers
revalidate HTML while CloudFront may keep it for five minutes between the full
invalidation performed by each deploy; hashed bundles remain immutable for one
year. The web manifest and service worker revalidate on every use.
The static behavior also attaches AWS's managed combined CORS and security-
headers policy (chosen when Drop's since-retired Buttondown archive loaded its
font), so static responses receive the standard transport, content-type, framing, and referrer
protections. `/api/*` keeps the API's own CORS behavior.

CloudFront standard logging v2 sends a privacy-minimized field set to CloudWatch Logs
for 24 months (731 days). It records status, bytes, cache/edge outcome, timing, content type, and a
bounded request class supplied by the routing function. It does not retain viewer IP,
user-agent, referrer, cookies, query strings, raw paths, or request IDs. API and Lambda
logs retain their existing 30-day incident window. Health checks consume the web records
only through the aggregate `scripts/web-activity.mjs` report.

The API behavior forwards viewer headers, cookies, and query strings except
`Host`. The viewer-request function overwrites `X-Elixir-Drop-Viewer-Ip` from
CloudFront's trusted `event.viewer.ip`. The Web Function's IAM-authenticated
endpoint and resource policy require this distribution, and its OAC preserves
bearer authorization. The HTTP server resolves viewer IP once; domain handlers
never parse public forwarding headers. The old origin marker and direct Gateway
path were retired with the October 2026 HTTP migration.

## Cutover record

- The ACM DNS-validation CNAME remains at the DNS provider. The certificate is
  non-exportable and managed by ACM in `us-east-1`.
- The `drop` CNAME points to the value emitted as
  `WebDistributionDomainName` (`d3pwhvwlrmohb1.cloudfront.net`).
- The site uses a same-origin `/api` base. Root, generated static pages, the API
  configuration and health route, and guest Practice were checked before the old
  host was retired; the deployment suite covers offline fallback.
- CI publishes only to private S3 and CloudFront. The repository no longer has a
  Pages `CNAME` file or Pages deployment job, and GitHub Pages is disabled.

Rollback is a normal revert on `main`; the serialized pipeline republishes the
prior API/web state. A DNS rollback to GitHub Pages is no longer maintained.

## Cost and protection

The distribution uses CloudFront pay-as-you-go, S3 Standard, Lambda Web Functions, and ACM. It adds no Route 53 hosted zone, load balancer, NAT gateway, WAF,
Lambda@Edge, or CodePipeline. Web endpoint rate/environment limits, application rate limits, and AWS Shield Standard
bound the initial risk.

AWS WAF is the first optional upgrade if measured abuse justifies its standing
cost. Start with one CloudFront rate-based rule; do not add a broad managed
ruleset without evidence that it addresses a real Drop traffic pattern.
