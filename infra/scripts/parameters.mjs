const SECRET_PARAMETERS = [
  ["SessionSecret", "SESSION_SECRET"],
  ["TelemetryPepper", "TELEMETRY_PEPPER"],
  ["FastmailJmapToken", "FASTMAIL_JMAP_TOKEN"],
  ["DiscordWebhookUrl", "ELIXIR_DROP_DISCORD_WEBHOOK_URL"],
];

function secretParameter(
  parameterKey,
  environmentKey,
  environment,
  stackExists,
) {
  const value = environment[environmentKey]?.trim();
  if (value) return { ParameterKey: parameterKey, ParameterValue: value };
  if (stackExists)
    return { ParameterKey: parameterKey, UsePreviousValue: true };
  throw new Error(
    `Missing ${environmentKey}; it is required when creating the API stack`,
  );
}

export function deploymentParameters({
  bucket,
  codeKey,
  environment,
  stackExists,
}) {
  const parameters = [
    { ParameterKey: "CodeBucket", ParameterValue: bucket },
    { ParameterKey: "CodeKey", ParameterValue: codeKey },
    {
      ParameterKey: "AppUrl",
      ParameterValue: environment.APP_URL || "https://drop.poapkings.com",
    },
    {
      ParameterKey: "EmailFrom",
      ParameterValue:
        environment.ELIXIR_DROP_EMAIL_FROM || "elixir@poapkings.com",
    },
    {
      ParameterKey: "AlarmEmail",
      ParameterValue:
        environment.ELIXIR_DROP_ALARM_EMAIL ||
        environment.ELIXIR_DROP_EMAIL_FROM ||
        "elixir@poapkings.com",
    },
    {
      ParameterKey: "MailCanaryEmail",
      ParameterValue:
        environment.ELIXIR_DROP_CANARY_EMAIL ||
        environment.ELIXIR_DROP_EMAIL_FROM ||
        "elixir@poapkings.com",
    },
    {
      ParameterKey: "NameModelId",
      ParameterValue:
        environment.NAME_MODEL_ID ||
        "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
    {
      ParameterKey: "WebVersion",
      ParameterValue: environment.WEB_VERSION?.trim() || "",
    },
  ];

  for (const [parameterKey, environmentKey] of [
    ["ButtondownApiKey", "BUTTONDOWN_API_KEY"],
    ["ButtondownNewsletterId", "BUTTONDOWN_NEWSLETTER_ID"],
  ]) {
    const value = environment[environmentKey]?.trim();
    if (value)
      parameters.push({ ParameterKey: parameterKey, ParameterValue: value });
  }

  for (const [parameterKey, environmentKey] of SECRET_PARAMETERS) {
    parameters.push(
      secretParameter(parameterKey, environmentKey, environment, stackExists),
    );
  }
  return parameters;
}
