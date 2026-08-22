# AWS web migration

Elixir Drop moved its static web build from GitHub Pages to the existing AWS
stack on August 22, 2026. DNS remains at the current provider. This is
deliberately a small hobby-project design:

```text
drop.poapkings.com -> CloudFront
  /*       -> private S3 web bucket through origin access control
  /api/*   -> existing API Gateway HTTP API -> Lambda -> DynamoDB
```

CloudFront runs one viewer-request function. It removes the `/api` prefix
before API Gateway sees the request and maps `/`, `/games/`, and the other
directory URLs to their generated `index.html` objects. API caching is disabled;
static objects follow the cache metadata assigned by `deploy-web.mjs`. Browsers
revalidate HTML while CloudFront may keep it for five minutes between the full
invalidation performed by each deploy; hashed bundles remain immutable for one
year. The web manifest and service worker revalidate on every use.
The static behavior also attaches AWS's managed combined CORS and security-
headers policy so Buttondown's public archive can load Drop's font while static
responses receive the standard transport, content-type, framing, and referrer
protections. `/api/*` keeps the API's own CORS behavior.

CloudFront standard logging v2 sends a privacy-minimized field set to CloudWatch Logs
for 14 days. It records status, bytes, cache/edge outcome, timing, content type, and a
bounded request class supplied by the routing function. It does not retain viewer IP,
user-agent, referrer, cookies, query strings, raw paths, or request IDs. API and Lambda
logs retain their existing 30-day incident window. Run Drop consumes the web records
only through the aggregate `scripts/web-activity.mjs` report.

The API behavior forwards viewer headers, cookies, and query strings except
`Host`. The viewer-request function overwrites `X-Elixir-Drop-Viewer-Ip` from
CloudFront's trusted `event.viewer.ip`, and CloudFront also overwrites a private
origin marker. Lambda trusts that address only when the marker matches. Direct
execute-api requests continue to use API Gateway's connection address. This
preserves per-player rate limits, analytics, and pseudonymous referee
correlation through the CDN.

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

The distribution uses CloudFront pay-as-you-go, S3 Standard, the existing HTTP
API, and ACM. It adds no Route 53 hosted zone, load balancer, NAT gateway, WAF,
Lambda@Edge, or CodePipeline. Existing API Gateway throttles, Lambda reserved
concurrency, application rate limits, the billing alarm, and AWS Shield Standard
bound the initial risk.

AWS WAF is the first optional upgrade if measured abuse justifies its standing
cost. Start with one CloudFront rate-based rule; do not add a broad managed
ruleset without evidence that it addresses a real Drop traffic pattern.
