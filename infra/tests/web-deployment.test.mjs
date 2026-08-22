import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cacheControlFor, contentTypeFor } from "../scripts/deploy-web.mjs";

const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);

void describe("AWS web hosting", () => {
  void it("keeps mutable entry points fresh and fingerprints immutable bundles", () => {
    assert.equal(cacheControlFor("index.html"), "no-cache");
    assert.equal(cacheControlFor("privacy/index.html"), "no-cache");
    assert.equal(cacheControlFor("api-config.json"), "no-store");
    assert.equal(cacheControlFor("version.json"), "no-store");
    assert.equal(cacheControlFor("card-art-sw.js"), "no-cache");
    assert.equal(
      cacheControlFor("assets/index-AbCdEf123.js"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      cacheControlFor("cards/26000000.png"),
      "public, max-age=604800",
    );
  });

  void it("sets browser-safe content types for the static build", () => {
    assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
    assert.equal(
      contentTypeFor("assets/index-12345678.js"),
      "text/javascript; charset=utf-8",
    );
    assert.equal(contentTypeFor("cards/26000000.png"), "image/png");
    assert.equal(contentTypeFor("assets/Clash.otf"), "font/otf");
  });

  void it("keeps S3 private and routes API traffic without caching", () => {
    assert.match(template, /BucketName: !Sub elixir-drop-web-/);
    assert.match(template, /BlockPublicAcls: true/);
    assert.match(template, /OriginAccessControlOriginType: s3/);
    assert.match(template, /SigningBehavior: always/);
    assert.match(template, /Principal:\s+Service: cloudfront\.amazonaws\.com/);
    assert.match(template, /PathPattern: \/api\/\*/);
    assert.match(
      template,
      /CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad/,
    );
    assert.match(
      template,
      /OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac/,
    );
    assert.match(template, /HeaderName: X-Elixir-Drop-Origin/);
    assert.match(template, /HeaderValue: !Ref WebOriginToken/);
    assert.match(
      template,
      /request\.headers\['x-elixir-drop-viewer-ip'\] = \{ value: event\.viewer\.ip \}/,
    );
  });

  void it("rewrites only after CloudFront has selected the API behavior", () => {
    assert.match(template, /if \(uri\.indexOf\('\/api\/'\) === 0\)/);
    assert.match(template, /request\.uri = uri\.slice\(4\) \|\| '\/'/);
    assert.match(template, /request\.uri = uri \+ '\/index\.html'/);
  });
});
