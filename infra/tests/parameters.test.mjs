import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deploymentParameters } from "../scripts/parameters.mjs";

const base = {
  bucket: "code-bucket",
  codeKey: "lambda/api.zip",
  environment: {},
};
const requiredCreateEnvironment = {
  SESSION_SECRET: "session-secret",
  TELEMETRY_PEPPER: "telemetry-pepper",
  FASTMAIL_JMAP_TOKEN: "jmap-token",
  ELIXIR_DROP_DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
  ELIXIR_DROP_WEB_ORIGIN_TOKEN: "private-origin-token",
  ELIXIR_DROP_WEB_CERTIFICATE_ARN:
    "arn:aws:acm:us-east-1:999153317627:certificate/example",
};
const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);
const bootstrap = readFileSync(
  new URL("../scripts/bootstrap.mjs", import.meta.url),
  "utf8",
);

// Every parameter template.yaml declares, read straight out of the Parameters
// block (top-level two-space keys, up to the next column-zero section).
const declaredParameters = (() => {
  const block = template.match(/^Parameters:\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(block, "template.yaml has no Parameters block to check against");
  return [...block.matchAll(/^ {2}([A-Za-z0-9]+):$/gm)].map(
    (match) => match[1],
  );
})();

function parameterDefault(name) {
  return template
    .match(new RegExp(`^ {2}${name}:\\n(?: {4}.*\\n)*`, "m"))?.[0]
    .match(/^ {4}Default: (.*)$/m)?.[1];
}

void describe("deployment parameters", () => {
  // The guard for the parameter-wipe class. CloudFormation resets every
  // parameter that an UpdateStack request omits back to its template Default,
  // so a parameter declared here but never sent is a silent production-config
  // wipe on the next push to main. Adding a parameter to template.yaml without
  // wiring it into parameters.mjs must break the build.
  void it("supplies or preserves every parameter the template declares", () => {
    assert.ok(
      declaredParameters.includes("CodeBucket") &&
        declaredParameters.includes("AllowedOrigins"),
      "the Parameters block parse is broken, so this guard would pass vacuously",
    );

    const parameters = deploymentParameters({ ...base, stackExists: true });
    const sent = new Map(
      parameters.map((parameter) => [parameter.ParameterKey, parameter]),
    );

    for (const name of declaredParameters) {
      const parameter = sent.get(name);
      assert.ok(
        parameter,
        `template.yaml declares the ${name} parameter but deploymentParameters() never sends it. CloudFormation resets omitted parameters to their Default on UpdateStack, so every deploy would wipe the deployed ${name}. Wire it into infra/scripts/parameters.mjs (explicit env value, else UsePreviousValue when the stack exists).`,
      );
      assert.ok(
        typeof parameter.ParameterValue === "string" ||
          parameter.UsePreviousValue === true,
        `${name} is sent without a ParameterValue and without UsePreviousValue`,
      );
    }

    for (const parameter of parameters) {
      assert.ok(
        declaredParameters.includes(parameter.ParameterKey),
        `deploymentParameters() sends ${parameter.ParameterKey}, which template.yaml does not declare; CloudFormation rejects unknown parameters and the deploy fails.`,
      );
    }
  });

  void it("uses Claude Haiku to edit player-name candidates by default", () => {
    assert.equal(
      parameterDefault("NameModelId"),
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    // Creating a stack without an override falls through to that Default.
    assert.equal(
      deploymentParameters({
        ...base,
        environment: requiredCreateEnvironment,
        stackExists: false,
      }).some((parameter) => parameter.ParameterKey === "NameModelId"),
      false,
    );
    assert.deepEqual(
      deploymentParameters({
        ...base,
        environment: { NAME_MODEL_ID: "us.anthropic.claude-other-v1:0" },
        stackExists: true,
      }).find((parameter) => parameter.ParameterKey === "NameModelId"),
      {
        ParameterKey: "NameModelId",
        ParameterValue: "us.anthropic.claude-other-v1:0",
      },
    );
  });

  void it("preserves operator-owned configuration on env-less CI updates", () => {
    // CI sets none of these. Sending the in-code literal instead would
    // overwrite an operator's change (a new alarm address, an extra CORS
    // origin) on every push to main — the same wipe as omitting the parameter.
    const parameters = deploymentParameters({ ...base, stackExists: true });

    for (const parameterKey of [
      "AppUrl",
      "EmailFrom",
      "AlarmEmail",
      "MailCanaryEmail",
      "NameModelId",
      "AllowedOrigins",
    ]) {
      assert.deepEqual(
        parameters.find((parameter) => parameter.ParameterKey === parameterKey),
        { ParameterKey: parameterKey, UsePreviousValue: true },
      );
    }
  });

  void it("keeps the CORS origin list templated on create and overridable", () => {
    assert.equal(
      parameterDefault("AllowedOrigins"),
      "https://drop.poapkings.com,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    );
    assert.match(template, /AllowOrigins: !Ref AllowedOrigins/);
    assert.equal(
      deploymentParameters({
        ...base,
        environment: requiredCreateEnvironment,
        stackExists: false,
      }).some((parameter) => parameter.ParameterKey === "AllowedOrigins"),
      false,
    );
    assert.deepEqual(
      deploymentParameters({
        ...base,
        environment: {
          ELIXIR_DROP_ALLOWED_ORIGINS:
            "https://drop.poapkings.com,https://staging.example",
        },
        stackExists: true,
      }).find((parameter) => parameter.ParameterKey === "AllowedOrigins"),
      {
        ParameterKey: "AllowedOrigins",
        ParameterValue: "https://drop.poapkings.com,https://staging.example",
      },
    );
  });

  void it("passes the front-end build version through, preserving it when unset", () => {
    // CI always supplies it, so this is the authoritative path.
    assert.deepEqual(
      deploymentParameters({
        ...base,
        environment: { WEB_VERSION: "abc123def456" },
        stackExists: true,
      }).find((parameter) => parameter.ParameterKey === "WebVersion"),
      { ParameterKey: "WebVersion", ParameterValue: "abc123def456" },
    );
    // An API-only deploy leaves the live web build untouched, so the deployed
    // version is unchanged rather than unknown. Blanking it would strip the
    // `web` provenance field from later referee evidence items.
    assert.deepEqual(
      deploymentParameters({ ...base, stackExists: true }).find(
        (parameter) => parameter.ParameterKey === "WebVersion",
      ),
      { ParameterKey: "WebVersion", UsePreviousValue: true },
    );
    // On create there is no previous value; the template Default applies.
    assert.equal(
      deploymentParameters({
        ...base,
        environment: requiredCreateEnvironment,
        stackExists: false,
      }).find((parameter) => parameter.ParameterKey === "WebVersion"),
      undefined,
    );
  });

  void it("reuses runtime secrets when updating an existing stack from CI", () => {
    const parameters = deploymentParameters({ ...base, stackExists: true });

    for (const parameterKey of [
      "SessionSecret",
      "TelemetryPepper",
      "FastmailJmapToken",
      "DiscordWebhookUrl",
    ]) {
      assert.deepEqual(
        parameters.find((parameter) => parameter.ParameterKey === parameterKey),
        { ParameterKey: parameterKey, UsePreviousValue: true },
      );
    }
  });

  void it("requires runtime secrets when creating the stack", () => {
    assert.throws(
      () => deploymentParameters({ ...base, stackExists: false }),
      /Missing SESSION_SECRET/,
    );
  });

  void it("supplies the CDN certificate and private origin marker", () => {
    const supplied = deploymentParameters({
      ...base,
      environment: requiredCreateEnvironment,
      stackExists: false,
    });
    assert.deepEqual(
      supplied.find(
        (parameter) => parameter.ParameterKey === "WebCertificateArn",
      ),
      {
        ParameterKey: "WebCertificateArn",
        ParameterValue:
          requiredCreateEnvironment.ELIXIR_DROP_WEB_CERTIFICATE_ARN,
      },
    );
    assert.deepEqual(
      supplied.find((parameter) => parameter.ParameterKey === "WebOriginToken"),
      {
        ParameterKey: "WebOriginToken",
        ParameterValue: requiredCreateEnvironment.ELIXIR_DROP_WEB_ORIGIN_TOKEN,
      },
    );

    const preserved = deploymentParameters({ ...base, stackExists: true });
    for (const parameterKey of ["WebCertificateArn", "WebOriginToken"]) {
      assert.deepEqual(
        preserved.find((parameter) => parameter.ParameterKey === parameterKey),
        { ParameterKey: parameterKey, UsePreviousValue: true },
      );
    }
  });

  void it("passes supplied runtime secrets during local creation or rotation", () => {
    const environment = {
      ...requiredCreateEnvironment,
      BUTTONDOWN_API_KEY: "buttondown-key",
      BUTTONDOWN_NEWSLETTER_ID: "news_2d3heqk1789vyatbxaeg4b2c91",
    };
    const parameters = deploymentParameters({
      ...base,
      environment,
      stackExists: false,
    });

    assert.deepEqual(
      parameters.find(
        (parameter) => parameter.ParameterKey === "SessionSecret",
      ),
      { ParameterKey: "SessionSecret", ParameterValue: "session-secret" },
    );
    assert.deepEqual(
      parameters.find(
        (parameter) => parameter.ParameterKey === "TelemetryPepper",
      ),
      { ParameterKey: "TelemetryPepper", ParameterValue: "telemetry-pepper" },
    );
    assert.deepEqual(
      parameters.find(
        (parameter) => parameter.ParameterKey === "ButtondownApiKey",
      ),
      { ParameterKey: "ButtondownApiKey", ParameterValue: "buttondown-key" },
    );
    assert.deepEqual(
      parameters.find(
        (parameter) => parameter.ParameterKey === "ButtondownNewsletterId",
      ),
      {
        ParameterKey: "ButtondownNewsletterId",
        ParameterValue: "news_2d3heqk1789vyatbxaeg4b2c91",
      },
    );
  });

  void it("preserves the deployed Buttondown credentials on env-less updates", () => {
    // CI deploys pass no Buttondown secrets. The parameters must reuse the
    // previously-deployed value; omitting them lets CloudFormation reset the
    // parameter to its "" Default and silently disable enrollment.
    const parameters = deploymentParameters({ ...base, stackExists: true });

    for (const parameterKey of ["ButtondownApiKey", "ButtondownNewsletterId"]) {
      assert.deepEqual(
        parameters.find((parameter) => parameter.ParameterKey === parameterKey),
        { ParameterKey: parameterKey, UsePreviousValue: true },
      );
    }
    assert.match(template, /BUTTONDOWN_API_KEY: !Ref ButtondownApiKey/);
    assert.match(
      template,
      /BUTTONDOWN_NEWSLETTER_ID: !Ref ButtondownNewsletterId/,
    );
  });

  void it("supplies and then preserves the server-only Tinylytics token", () => {
    const supplied = deploymentParameters({
      ...base,
      environment: { TINYLYTICS_API_TOKEN: "tinylytics-key" },
      stackExists: true,
    });
    assert.deepEqual(
      supplied.find(
        (parameter) => parameter.ParameterKey === "TinylyticsApiToken",
      ),
      {
        ParameterKey: "TinylyticsApiToken",
        ParameterValue: "tinylytics-key",
      },
    );

    const preserved = deploymentParameters({ ...base, stackExists: true });
    assert.deepEqual(
      preserved.find(
        (parameter) => parameter.ParameterKey === "TinylyticsApiToken",
      ),
      { ParameterKey: "TinylyticsApiToken", UsePreviousValue: true },
    );
    assert.match(
      template,
      /TinylyticsApiToken:\n {4}Type: String\n {4}NoEcho: true/,
    );
    assert.match(template, /TINYLYTICS_API_TOKEN: !Ref TinylyticsApiToken/);
  });

  void it("keeps Tinylytics disabled on stack creation without a token", () => {
    const parameters = deploymentParameters({
      ...base,
      environment: requiredCreateEnvironment,
      stackExists: false,
    });
    assert.equal(
      parameters.some(
        (parameter) => parameter.ParameterKey === "TinylyticsApiToken",
      ),
      false,
    );
  });

  void it("omits Buttondown parameters on stack creation without credentials", () => {
    // No previous value exists yet on create; omitting lets the "" Default
    // apply so a fresh stack comes up with Buttondown cleanly disabled.
    const parameters = deploymentParameters({
      ...base,
      environment: requiredCreateEnvironment,
      stackExists: false,
    });

    assert.equal(
      parameters.some((parameter) =>
        parameter.ParameterKey.startsWith("Buttondown"),
      ),
      false,
    );
  });

  void it("routes operational alarms to the configured address", () => {
    const parameters = deploymentParameters({
      ...base,
      environment: { ELIXIR_DROP_ALARM_EMAIL: "alerts@example.com" },
      stackExists: true,
    });

    assert.deepEqual(
      parameters.find((parameter) => parameter.ParameterKey === "AlarmEmail"),
      { ParameterKey: "AlarmEmail", ParameterValue: "alerts@example.com" },
    );
  });

  void it("separates Drop admin recipients from the Elixir magic-link sender", () => {
    // The default lives in the template (it applies on create); an env-less
    // update preserves whatever address is deployed, asserted above.
    assert.equal(parameterDefault("MailCanaryEmail"), "drop@poapkings.com");
    assert.equal(parameterDefault("AlarmEmail"), "drop@poapkings.com");
    assert.equal(parameterDefault("EmailFrom"), "elixir@poapkings.com");

    const overridden = deploymentParameters({
      ...base,
      environment: { ELIXIR_DROP_CANARY_EMAIL: "canary@example.com" },
      stackExists: true,
    });
    assert.deepEqual(
      overridden.find(
        (parameter) => parameter.ParameterKey === "MailCanaryEmail",
      ),
      {
        ParameterKey: "MailCanaryEmail",
        ParameterValue: "canary@example.com",
      },
    );

    // The sender is independent: changing it must not retarget administrative
    // mail, so only EmailFrom is present in this update.
    const fromOnly = deploymentParameters({
      ...base,
      environment: { ELIXIR_DROP_EMAIL_FROM: "drop@example.com" },
      stackExists: true,
    });
    assert.deepEqual(
      fromOnly.find((parameter) => parameter.ParameterKey === "EmailFrom"),
      { ParameterKey: "EmailFrom", ParameterValue: "drop@example.com" },
    );
    assert.deepEqual(
      fromOnly.find((parameter) => parameter.ParameterKey === "AlarmEmail"),
      { ParameterKey: "AlarmEmail", UsePreviousValue: true },
    );
    assert.deepEqual(
      fromOnly.find(
        (parameter) => parameter.ParameterKey === "MailCanaryEmail",
      ),
      { ParameterKey: "MailCanaryEmail", UsePreviousValue: true },
    );
  });

  void it("alarms on observable API 5xx responses and retains structured logs", () => {
    assert.match(template, /Namespace: AWS\/ApiGateway\s+MetricName: 5xx/);
    assert.match(
      template,
      /LogGroupName: \/elixir-drop\/api\s+RetentionInDays: 30/,
    );
    assert.match(template, /Handler: handler\.mailCanaryHandler/);
    assert.match(template, /ScheduleExpression: cron\(0 13 \* \* \? \*\)/);
    assert.match(template, /AlarmName: elixir-drop-mail-canary-missing/);
    assert.match(template, /dynamodb:BatchWriteItem/);
    assert.match(template, /- DELETE/);
  });

  void it("records privacy-conscious route timing and detailed HTTP API metrics", () => {
    assert.match(
      template,
      /LogGroupName: \/elixir-drop\/api-access\s+RetentionInDays: 30/,
    );
    const accessLogFormat = template.match(
      /AccessLogSettings:[\s\S]*?Format: >-\s+([^\n]+)/,
    )?.[1];
    assert.ok(accessLogFormat);
    for (const field of [
      "$context.requestId",
      "$context.routeKey",
      "$context.status",
      "$context.responseLatency",
      "$context.integrationLatency",
      "$context.integration.status",
      "$context.responseLength",
    ]) {
      assert.match(accessLogFormat, new RegExp(field.replaceAll("$", "\\$")));
    }
    assert.doesNotMatch(
      accessLogFormat,
      /identity|authorizer|sourceIp|userAgent|queryString|path/,
    );
    assert.match(template, /DetailedMetricsEnabled: true/);

    const routeKeys = [...template.matchAll(/^ {6}RouteKey: (.+)$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(routeKeys, [
      "$default",
      "GET /health",
      "POST /auth/request",
      "POST /auth/poll",
      "POST /auth/redeem",
      "POST /auth/refresh",
      "GET /me",
      "GET /me/seasons",
      "GET /players/{playerId}",
      "POST /me/name-options",
      "DELETE /me",
      "PATCH /me",
      "POST /runs/start",
      "POST /runs/complete",
      "POST /run-reports",
      "POST /runs/{runId}/share",
      "GET /shares/{token}",
      "GET /leaderboards",
      "GET /seasons",
      "GET /activity",
      "GET /stats",
    ]);
  });

  void it("defines a valid operations dashboard and baseline-backed alarms", () => {
    const dashboardBody = template
      .match(/DashboardBody: !Sub \|\n((?: {8}.*\n)+)/)?.[1]
      .replaceAll(/^ {8}/gm, "")
      .replaceAll(/\$\{[^}]+\}/g, "placeholder");
    assert.ok(dashboardBody);
    const dashboard = JSON.parse(dashboardBody);
    assert.equal(dashboard.start, "-PT8H");
    assert.equal(dashboard.periodOverride, "inherit");
    assert.equal(dashboard.widgets[0].type, "alarm");
    assert.equal(dashboard.widgets.length, 9);

    const routeRequests = dashboard.widgets.find(
      (widget) => widget.properties?.title === "Requests by API route",
    );
    const routeLatency = dashboard.widgets.find(
      (widget) => widget.properties?.title === "p95 latency by API route",
    );
    assert.ok(routeRequests);
    assert.ok(routeLatency);
    assert.match(
      routeRequests.properties.metrics[0][0].expression,
      /AWS\/ApiGateway,ApiId,Stage,Method,Resource.*MetricName="Count".*'Sum'/,
    );
    assert.match(
      routeLatency.properties.metrics[0][0].expression,
      /AWS\/ApiGateway,ApiId,Stage,Method,Resource.*MetricName="Latency".*'p95'/,
    );

    assert.match(template, /PolicyName: elixir-drop-dashboard-management/);
    assert.match(template, /- cloudwatch:PutDashboard/);
    assert.match(
      template,
      /OperationsDashboard:[\s\S]*?DependsOn: CloudFormationDashboardPolicy/,
    );

    assert.match(template, /AlarmName: elixir-drop-api-latency-p95/);
    assert.match(template, /ExtendedStatistic: p95[\s\S]*?Threshold: 1200/);
    assert.match(template, /AlarmName: elixir-drop-api-latency-p99/);
    assert.match(template, /ExtendedStatistic: p99[\s\S]*?Threshold: 2000/);
    assert.match(template, /AlarmName: elixir-drop-api-concurrency/);
    assert.match(
      template,
      /MetricName: ConcurrentExecutions[\s\S]*?Threshold: 20/,
    );
    assert.match(template, /AlarmName: elixir-drop-dynamodb-throttles/);
    assert.match(template, /MetricName: ReadThrottleEvents/);
    assert.match(template, /MetricName: WriteThrottleEvents/);
    assert.match(template, /AlarmName: elixir-drop-dynamodb-system-errors/);
    assert.match(template, /Expression: SUM\(METRICS\(\)\)/);
  });

  void it("indexes public profile UUIDs without projecting email", () => {
    const publicProfileIndex = template.match(
      /- IndexName: GSI3[\s\S]*?(?=\n      PointInTimeRecoverySpecification:)/,
    )?.[0];
    assert.ok(publicProfileIndex);
    assert.match(publicProfileIndex, /AttributeName: playerId\s+KeyType: HASH/);
    assert.match(publicProfileIndex, /- publicName/);
    assert.match(publicProfileIndex, /- totalGames/);
    assert.doesNotMatch(publicProfileIndex, /- email/);
  });

  void it("allows CloudFormation to manage scheduled structured logs", () => {
    assert.match(bootstrap, /"events:\*"/);
    assert.match(bootstrap, /"logs:\*"/);
    assert.match(
      bootstrap,
      /arn:aws:cloudwatch::\$\{accountId\}:dashboard\/elixir-drop-\*/,
    );
  });

  void it("bounds web deployment permissions to the Drop bucket and invalidations", () => {
    assert.match(bootstrap, /cloudfront:CreateDistribution/);
    assert.match(bootstrap, /cloudfront:CreateOriginAccessControl/);
    assert.match(bootstrap, /cloudfront:PublishFunction/);
    assert.doesNotMatch(bootstrap, /Action: \["cloudfront:\*"\]/);
    assert.match(bootstrap, /elixir-drop-web-\$\{accountId\}-\$\{region\}/);
    assert.match(bootstrap, /cloudfront:CreateInvalidation/);
    assert.match(bootstrap, /s3:DeleteObject/);
  });

  void it("keeps simple CORS on static assets without changing the API behavior", () => {
    assert.match(
      template,
      /DefaultCacheBehavior:[\s\S]*?ResponseHeadersPolicyId: 60669652-455b-4ae9-85a4-c4c02393f86c/,
    );
    const apiBehavior = template.match(
      /CacheBehaviors:[\s\S]*?\n        Comment:/,
    )?.[0];
    assert.ok(apiBehavior);
    assert.doesNotMatch(apiBehavior, /ResponseHeadersPolicyId/);
  });

  void it("lets CloudFormation inspect policies only for Elixir Drop roles", () => {
    const roleManagementPolicy = bootstrap.match(
      /\{\s+Effect: "Allow",\s+Action: \[\s+"iam:CreateRole",[\s\S]*?Resource: `arn:aws:iam::\$\{accountId\}:role\/elixir-drop-\*`,\s+\},/,
    )?.[0];
    assert.ok(roleManagementPolicy);
    assert.match(roleManagementPolicy, /"iam:ListAttachedRolePolicies"/);
    assert.match(roleManagementPolicy, /"iam:ListRolePolicies"/);
  });

  void it("bounds referee writes to its independent decision partitions", () => {
    const refereeRole = template.match(
      /  RefereeReadRole:[\s\S]*?\n  DropControlRole:/,
    )?.[0];
    assert.ok(refereeRole);
    assert.match(refereeRole, /PolicyName: elixir-drop-referee-bounded/);
    assert.match(
      refereeRole,
      /- Effect: Allow\s+Action:\s+- dynamodb:PutItem\s+- dynamodb:TransactWriteItems\s+- dynamodb:UpdateItem\s+Resource: !GetAtt DataTable\.Arn\s+Condition:\s+ForAllValues:StringLike:\s+dynamodb:LeadingKeys:\s+- REFEREE#\*/,
    );
    assert.match(bootstrap, /PolicyName: "elixir-drop-referee-assume"/);
    assert.match(bootstrap, /Action: "sts:AssumeRole"/);
    assert.match(bootstrap, /role\/elixir-drop-referee-read/);
  });

  void it("bounds referee reads to the partitions and indexes it reviews", () => {
    const refereeRole = template.match(
      /  RefereeReadRole:[\s\S]*?\n  DropControlRole:/,
    )?.[0];
    assert.ok(refereeRole);

    // Keyed reads only reach the profile/run/evidence, decision, and war-clock
    // partitions. MAGIC# items carry a raw email and POLL# items carry session
    // envelopes; neither is addressable.
    assert.match(
      refereeRole,
      /- dynamodb:GetItem\s+- dynamodb:BatchGetItem\s+- dynamodb:Query\s+Resource: !GetAtt DataTable\.Arn\s+Condition:\s+ForAllValues:StringLike:\s+dynamodb:LeadingKeys:\s+- PLAYER#\*\s+- REFEREE#\*\s+- CR_WAR_CLOCK/,
    );

    // Index reads name the two indexes the scripts query. The public-profile
    // GSI3 and any future index are not granted.
    assert.match(refereeRole, /index\/GSI1/);
    assert.match(refereeRole, /index\/GSI2/);
    assert.doesNotMatch(refereeRole, /index\/GSI3/);
    // The one remaining wildcard is the Deny below, never an Allow.
    assert.doesNotMatch(
      refereeRole,
      /Effect: Allow[\s\S]*?index\/\*[\s\S]*?Effect: Deny/,
    );

    // Scan cannot take a LeadingKeys condition, so it is bounded to the base
    // table: no index scan, and no read may name an identity attribute.
    assert.match(
      refereeRole,
      /Action: dynamodb:Scan\s+Resource: !GetAtt DataTable\.Arn/,
    );
    assert.match(
      refereeRole,
      /Effect: Deny[\s\S]*?ForAnyValue:StringEquals:\s+dynamodb:Attributes:\s+- sub\s+- playerSub\s+- owner\s+- email/,
    );

    // The only direct mutation is the badge-revision update inside a bounded
    // transaction; the REFEREE# LeadingKeys condition keeps canonical data out.
    assert.doesNotMatch(refereeRole, /dynamodb:(?:DeleteItem|BatchWriteItem)/);
  });

  void it("separates identity-free run report triage behind its own role", () => {
    const reportsRole = template.match(
      /  RunReportsRole:[\s\S]*?\n  DropControlRole:/,
    )?.[0];
    assert.ok(reportsRole);
    assert.match(reportsRole, /RoleName: elixir-drop-run-reports/);
    assert.match(reportsRole, /Action: dynamodb:Query/);
    assert.match(reportsRole, /Action: dynamodb:TransactWriteItems/);
    assert.match(reportsRole, /dynamodb:LeadingKeys:\s+- RUN_REPORTS/);
    assert.doesNotMatch(
      reportsRole,
      /PLAYER#|REFEREE#|dynamodb:(?:Scan|GetItem|DeleteItem|UpdateItem|PutItem)/,
    );
    assert.match(
      reportsRole,
      /Principal:\s+AWS: !Sub arn:\$\{AWS::Partition\}:iam::\$\{AWS::AccountId\}:user\/elixir-drop/,
    );
    assert.match(
      template,
      /RunReportsRoleArn:\s+Value: !GetAtt RunReportsRole\.Arn/,
    );
  });

  void it("separates account support from pseudonymous referee evidence", () => {
    const controlRole = template.match(
      /  DropControlRole:[\s\S]*?\n  LeaderboardMaintenanceRole:/,
    )?.[0];
    assert.ok(controlRole);
    assert.match(controlRole, /RoleName: elixir-drop-control/);
    assert.match(
      controlRole,
      /Action: dynamodb:Scan[\s\S]*dynamodb:Select: SPECIFIC_ATTRIBUTES/,
    );
    assert.match(controlRole, /- email/);
    assert.match(controlRole, /Action: dynamodb:TransactWriteItems/);
    assert.match(controlRole, /- CONTROL#PLAYER#\*/);
    assert.doesNotMatch(
      controlRole,
      /dynamodb:(?:DeleteItem|PutItem|UpdateItem|BatchWriteItem)/,
    );
    assert.doesNotMatch(
      controlRole.match(/dynamodb:TransactWriteItems[\s\S]*$/)?.[0] ?? "",
      /- email/,
    );
    assert.match(bootstrap, /role\/elixir-drop-control/);
  });

  void it("bounds leaderboard maintenance to sparse index attributes", () => {
    const maintenanceRole = template.match(
      /  LeaderboardMaintenanceRole:[\s\S]*?\n  ApiFunction:/,
    )?.[0];
    assert.ok(maintenanceRole);
    assert.match(
      maintenanceRole,
      /RoleName: elixir-drop-leaderboard-maintenance/,
    );
    assert.match(maintenanceRole, /user\/elixir-drop/);
    assert.match(maintenanceRole, /Action: dynamodb:UpdateItem/);
    assert.match(maintenanceRole, /dynamodb:LeadingKeys:[\s\S]*- PLAYER#\*/);
    assert.match(
      maintenanceRole,
      /dynamodb:Attributes:[\s\S]*- pk[\s\S]*- sk[\s\S]*- GSI1PK[\s\S]*- GSI1SK/,
    );
    assert.doesNotMatch(
      maintenanceRole,
      /dynamodb:(?:DeleteItem|PutItem|BatchWriteItem|TransactWriteItems)/,
    );
  });
});
