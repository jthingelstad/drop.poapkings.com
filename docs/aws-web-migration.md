# AWS web migration

Elixir Drop is moving its static web build from GitHub Pages to the existing
AWS stack. DNS remains at the current provider. This is deliberately a small
hobby-project design:

```text
drop.poapkings.com -> CloudFront
  /*       -> private S3 web bucket through origin access control
  /api/*   -> existing API Gateway HTTP API -> Lambda -> DynamoDB
```

CloudFront runs one viewer-request function. It removes the `/api` prefix
before API Gateway sees the request and maps `/`, `/games/`, and the other
directory URLs to their generated `index.html` objects. API caching is disabled;
static objects follow the cache metadata assigned by `deploy-web.mjs`.

The API behavior forwards viewer headers, cookies, and query strings except
`Host`. The viewer-request function overwrites `X-Elixir-Drop-Viewer-Ip` from
CloudFront's trusted `event.viewer.ip`, and CloudFront also overwrites a private
origin marker. Lambda trusts that address only when the marker matches. Direct
execute-api requests continue to use API Gateway's connection address. This
preserves per-player rate limits, analytics, and pseudonymous referee
correlation through the CDN.

## Cutover

1. Add and retain the ACM DNS-validation CNAME. The certificate is
   non-exportable and managed by ACM in `us-east-1`.
2. Deploy the AWS resources and publish the exact web build to both GitHub Pages
   and the private S3 bucket. The Pages copy keeps the direct API endpoint; the
   AWS copy uses the same-origin `/api` base.
3. Verify the CloudFront hostname: root page, generated static pages,
   `api-config.json`, API health, authentication, a guest Practice run, and
   offline fallback.
4. At the DNS provider, replace the existing `drop` CNAME target
   `jthingelstad.github.io` with the distribution hostname emitted as
   `WebDistributionDomainName`. Leave TTL at the current automatic/default
   value (about 30 minutes).
5. Verify `https://drop.poapkings.com` through public DNS and allow one TTL for
   caches to converge.
6. Remove the Pages publish job and `apps/web/public/CNAME`, then disable GitHub
   Pages after the AWS-only deployment succeeds.

Until step 6, rollback is one DNS edit: point the `drop` CNAME back to
`jthingelstad.github.io`. Do not delete the Pages deployment during the
convergence window.

## Cost and protection

The distribution uses CloudFront pay-as-you-go, S3 Standard, the existing HTTP
API, and ACM. It adds no Route 53 hosted zone, load balancer, NAT gateway, WAF,
Lambda@Edge, or CodePipeline. Existing API Gateway throttles, Lambda reserved
concurrency, application rate limits, the billing alarm, and AWS Shield Standard
bound the initial risk.

AWS WAF is the first optional upgrade if measured abuse justifies its standing
cost. Start with one CloudFront rate-based rule; do not add a broad managed
ruleset without evidence that it addresses a real Drop traffic pattern.
