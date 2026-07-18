import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deploymentParameters } from "../scripts/parameters.mjs";

const base = {
  bucket: "code-bucket",
  codeKey: "lambda/api.zip",
  environment: {},
};

describe("deployment parameters", () => {
  it("reuses runtime secrets when updating an existing stack from CI", () => {
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

  it("requires runtime secrets when creating the stack", () => {
    assert.throws(
      () => deploymentParameters({ ...base, stackExists: false }),
      /Missing SESSION_SECRET/,
    );
  });

  it("passes supplied runtime secrets during local creation or rotation", () => {
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
});
