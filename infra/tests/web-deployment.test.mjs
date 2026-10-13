import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { cacheControlFor, contentTypeFor } from "../scripts/deploy-web.mjs";

const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);

const webRequestFunctionCode = template
  .match(/FunctionCode: \|\n([\s\S]*?)\n\n  WebCachePolicy:/)?.[1]
  .replaceAll(/^ {8}/gm, "");

void describe("AWS web hosting", () => {
  void it("grants the native CloudFormation handler's tag read on the Web Function", () => {
    const policy = template.match(
      /  CloudFormationWebFunctionPolicy:[\s\S]*?(?=\n  WebCodeBucketPolicy:)/,
    )?.[0];
    assert.ok(policy);
    // AWS::Lambda::WebFunction's read/delete handlers require ListTags,
    // even though the Lambda Web SDK operation is ListTagsForResource.
    assert.match(policy, /lambda:ListTags,/);
    assert.doesNotMatch(policy, /lambda:ListTagsForResource/);
    assert.match(policy, /web-function\/elixir-drop-web-api/);
  });

  void it("keeps mutable entry points fresh and fingerprints immutable bundles", () => {
    assert.equal(
      cacheControlFor("index.html"),
      "public, max-age=0, s-maxage=300",
    );
    assert.equal(
      cacheControlFor("privacy/index.html"),
      "public, max-age=0, s-maxage=300",
    );
    assert.equal(cacheControlFor("api-config.json"), "no-store");
    assert.equal(cacheControlFor("version.json"), "no-store");
    assert.equal(cacheControlFor("card-art-sw.js"), "no-cache");
    assert.equal(cacheControlFor("site.webmanifest"), "no-cache");
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
    assert.match(template, /PathPattern: \/updates\/\*/);
    assert.match(template, /PathPattern: \/feed\.xml/);
    assert.match(template, /CachePolicyId: !Ref ApiCachePolicy/);
    assert.match(
      template,
      /OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac/,
    );
    assert.match(template, /SigningBehavior: always-amz-auth/);
    // A fully-disabled policy rejects header whitelisting in CloudFront.
    // Min/default zero plus a nonzero ceiling honors private/no-store while
    // admitting the Authorization key needed by Web Function OAC.
    const apiPolicy = template.match(
      /  ApiCachePolicy:[\s\S]*?(?=\n  PublicApiCachePolicy:)/,
    )?.[0];
    assert.ok(apiPolicy);
    assert.match(apiPolicy, /MinTTL: 0/);
    assert.match(apiPolicy, /DefaultTTL: 0/);
    assert.match(apiPolicy, /MaxTTL: 1/);
    assert.match(template, /Headers: \[Authorization\]/);
    assert.doesNotMatch(
      template,
      /AWS::ApiGateway|WebOriginToken|X-Elixir-Drop-Origin/,
    );
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

  void it("logs only safe request classes while preserving routing", () => {
    assert.ok(webRequestFunctionCode);
    assert.match(webRequestFunctionCode, /import cf from 'cloudfront';/);
    const logged = [];
    const executableCode = webRequestFunctionCode.replace(
      "import cf from 'cloudfront';",
      "",
    );
    const handler = runInNewContext(`${executableCode}\nhandler`, {
      cf: { logCustomData: (value) => logged.push(value) },
    });
    const request = (uri, querystring) =>
      handler({
        request: {
          headers: {},
          rawQueryString: () => querystring,
          uri,
        },
        viewer: { ip: "192.0.2.1" },
      });

    assert.equal(request("/").uri, "/index.html");
    assert.equal(request("/about/").uri, "/about/index.html");
    const authRedirect = request(
      "/auth",
      "token=private-token&returnTo=%2Fsurge",
    );
    assert.equal(authRedirect.statusCode, 302);
    assert.equal(authRedirect.headers["cache-control"].value, "no-store");
    assert.equal(
      authRedirect.headers.location.value,
      "/#/auth?token=private-token&returnTo=%2Fsurge",
    );
    assert.equal(request("/auth/").headers.location.value, "/#/auth");
    assert.equal(
      request("/assets/index-12345678.js").uri,
      "/assets/index-12345678.js",
    );
    assert.equal(request("/cards/26000000.png").uri, "/cards/26000000.png");
    assert.equal(
      request("/api/runs/private-run-id/share").uri,
      "/runs/private-run-id/share",
    );
    const updates = request("/updates/");
    assert.equal(updates.uri, "/updates/archive");
    assert.equal(updates.headers["x-elixir-drop-viewer-ip"].value, "192.0.2.1");
    assert.equal(request("/feed.xml").uri, "/feed.xml");
    assert.deepEqual(logged, [
      "web-home",
      "web-page-about",
      "web-auth-recovery",
      "web-auth-recovery",
      "web-asset",
      "web-card-art",
      "api",
      "web-page-updates",
      "web-discovery",
    ]);
    assert.doesNotMatch(
      logged.join(" "),
      /192\.0\.2\.1|private-run-id|private-token/,
    );
  });
});
