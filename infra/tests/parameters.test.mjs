import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deploymentParameters } from "../scripts/parameters.mjs";

const base = {
  bucket: "code-bucket",
  codeKey: "lambda/api.zip",
  environment: {},
};
const template = readFileSync(
  new URL("../template.yaml", import.meta.url),
  "utf8",
);
const bootstrap = readFileSync(
  new URL("../scripts/bootstrap.mjs", import.meta.url),
  "utf8",
);

void describe("deployment parameters", () => {
  void it("uses Claude Haiku for creative player names by default", () => {
    const parameters = deploymentParameters({ ...base, stackExists: true });

    assert.deepEqual(
      parameters.find((parameter) => parameter.ParameterKey === "NameModelId"),
      {
        ParameterKey: "NameModelId",
        ParameterValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
    );
  });

  void it("passes the front-end build version through, empty when unset", () => {
    assert.deepEqual(
      deploymentParameters({ ...base, stackExists: true }).find(
        (parameter) => parameter.ParameterKey === "WebVersion",
      ),
      { ParameterKey: "WebVersion", ParameterValue: "" },
    );
    assert.deepEqual(
      deploymentParameters({
        ...base,
        environment: { WEB_VERSION: "abc123def456" },
        stackExists: true,
      }).find((parameter) => parameter.ParameterKey === "WebVersion"),
      { ParameterKey: "WebVersion", ParameterValue: "abc123def456" },
    );
  });

  void it("reuses runtime secrets when updating an existing stack from CI", () => {
    const parameters = deploymentParameters({ ...base, stackExists: true });

    for (const parameterKey of [
      "SessionSecret",
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

  void it("passes supplied runtime secrets during local creation or rotation", () => {
    const environment = {
      SESSION_SECRET: "session-secret",
      FASTMAIL_JMAP_TOKEN: "jmap-token",
      ELIXIR_DROP_DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
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

  void it("sends the mail canary to Elixir by default or an explicit override", () => {
    const defaults = deploymentParameters({ ...base, stackExists: true });
    const overridden = deploymentParameters({
      ...base,
      environment: { ELIXIR_DROP_CANARY_EMAIL: "canary@example.com" },
      stackExists: true,
    });

    assert.deepEqual(
      defaults.find(
        (parameter) => parameter.ParameterKey === "MailCanaryEmail",
      ),
      {
        ParameterKey: "MailCanaryEmail",
        ParameterValue: "elixir@poapkings.com",
      },
    );
    assert.deepEqual(
      overridden.find(
        (parameter) => parameter.ParameterKey === "MailCanaryEmail",
      ),
      {
        ParameterKey: "MailCanaryEmail",
        ParameterValue: "canary@example.com",
      },
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

  void it("allows CloudFormation to manage scheduled structured logs", () => {
    assert.match(bootstrap, /"events:\*"/);
    assert.match(bootstrap, /"logs:\*"/);
  });
});
