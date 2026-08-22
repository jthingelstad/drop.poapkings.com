const SECRET_PARAMETERS = [
  ["SessionSecret", "SESSION_SECRET"],
  ["TelemetryPepper", "TELEMETRY_PEPPER"],
  ["FastmailJmapToken", "FASTMAIL_JMAP_TOKEN"],
  ["DiscordWebhookUrl", "ELIXIR_DROP_DISCORD_WEBHOOK_URL"],
  ["WebOriginToken", "ELIXIR_DROP_WEB_ORIGIN_TOKEN"],
];

const REQUIRED_PARAMETERS = [
  ["WebCertificateArn", "ELIXIR_DROP_WEB_CERTIFICATE_ARN"],
];

// Operator-owned configuration: everything the template declares that CI does
// not supply on every deploy. The environment keys are the local/managed-host
// overrides; CI sets none of them.
//
// On UpdateStack, CloudFormation resets EVERY parameter that is absent from the
// request to its template Default. Sending an in-code literal here instead of
// UsePreviousValue is the same bug in a different shape: it silently overwrites
// whatever the value was actually deployed with. So each of these is
// preserve-by-default and only moves when an operator passes a value.
const PRESERVED_PARAMETERS = [
  ["AppUrl", ["APP_URL"]],
  ["EmailFrom", ["ELIXIR_DROP_EMAIL_FROM"]],
  // Administrative delivery is deliberately independent of the player-mail
  // sender. Changing elixir@ (magic links) must never retarget alarms or the
  // canary away from the monitored drop@ mailbox.
  ["AlarmEmail", ["ELIXIR_DROP_ALARM_EMAIL"]],
  ["MailCanaryEmail", ["ELIXIR_DROP_CANARY_EMAIL"]],
  ["NameModelId", ["NAME_MODEL_ID"]],
  // The front-end build sha. CI always supplies it (deploy.yml sets
  // WEB_VERSION: github.sha), so preserving only affects an API-only deploy —
  // and there the live web build is unchanged, not unknown. Blanking it would
  // drop the `web` provenance field from every subsequent referee evidence item
  // (referee-evidence.ts) and silence the stale-tab update banner.
  ["WebVersion", ["WEB_VERSION"]],
  // CommaDelimitedList: a comma-separated string is the wire form. It feeds the
  // HTTP API CORS AllowOrigins, so resetting it to the Default would revoke any
  // origin an operator added.
  ["AllowedOrigins", ["ELIXIR_DROP_ALLOWED_ORIGINS"]],
  ["ButtondownApiKey", ["BUTTONDOWN_API_KEY"]],
  ["ButtondownNewsletterId", ["BUTTONDOWN_NEWSLETTER_ID"]],
  ["TinylyticsApiToken", ["TINYLYTICS_API_TOKEN"]],
];

function firstValue(environment, environmentKeys) {
  for (const environmentKey of environmentKeys) {
    const value = environment[environmentKey]?.trim();
    if (value) return value;
  }
  return undefined;
}

// Explicit value wins; otherwise reuse what is already deployed; on stack
// creation there is no previous value, so omit the parameter and let the
// template Default apply.
function preservedParameter(parameterKey, value, stackExists) {
  if (value) return { ParameterKey: parameterKey, ParameterValue: value };
  if (stackExists)
    return { ParameterKey: parameterKey, UsePreviousValue: true };
  return undefined;
}

function requiredParameter(
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
  ];

  for (const [parameterKey, environmentKeys] of PRESERVED_PARAMETERS) {
    const parameter = preservedParameter(
      parameterKey,
      firstValue(environment, environmentKeys),
      stackExists,
    );
    if (parameter) parameters.push(parameter);
  }

  for (const [parameterKey, environmentKey] of SECRET_PARAMETERS) {
    parameters.push(
      requiredParameter(parameterKey, environmentKey, environment, stackExists),
    );
  }

  for (const [parameterKey, environmentKey] of REQUIRED_PARAMETERS) {
    parameters.push(
      requiredParameter(parameterKey, environmentKey, environment, stackExists),
    );
  }
  return parameters;
}
