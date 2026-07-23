export interface Config {
  tableName: string;
  sessionSecret: string;
  // Server-only pepper for the referee correlation HMACs (see
  // referee-evidence.ts). Guarded exactly like SESSION_SECRET: Lambda env only,
  // never in the referee scripts, the read-only role, CI, or the browser.
  telemetryPepper: string;
  appUrl: string;
  jmapToken: string;
  buttondownApiKey?: string;
  buttondownNewsletterId?: string;
  emailFrom: string;
  emailFromName: string;
  nameModelId: string;
  discordWebhookUrl?: string;
  crRequestQueueUrl: string;
  // Current front-end build id (first 12 chars of the git sha), reported on
  // /stats so stale tabs can prompt a reload. Absent until a deploy sets it.
  webVersion?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig(): Config {
  const buttondownApiKey = process.env.BUTTONDOWN_API_KEY?.trim() || undefined;
  const buttondownNewsletterId =
    process.env.BUTTONDOWN_NEWSLETTER_ID?.trim() || undefined;
  if (Boolean(buttondownApiKey) !== Boolean(buttondownNewsletterId)) {
    throw new Error(
      "BUTTONDOWN_API_KEY and BUTTONDOWN_NEWSLETTER_ID must be configured together",
    );
  }
  return {
    tableName: required("TABLE_NAME"),
    sessionSecret: required("SESSION_SECRET"),
    telemetryPepper: required("TELEMETRY_PEPPER"),
    appUrl: required("APP_URL").replace(/\/$/, ""),
    jmapToken: required("FASTMAIL_JMAP_TOKEN"),
    buttondownApiKey,
    buttondownNewsletterId,
    emailFrom:
      process.env.ELIXIR_DROP_EMAIL_FROM?.trim() || "elixir@poapkings.com",
    emailFromName:
      process.env.ELIXIR_DROP_EMAIL_FROM_NAME?.trim() || "Elixir Drop",
    nameModelId:
      process.env.NAME_MODEL_ID?.trim() ||
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    discordWebhookUrl:
      process.env.ELIXIR_DROP_DISCORD_WEBHOOK_URL?.trim() || undefined,
    crRequestQueueUrl: required("CR_REQUEST_QUEUE_URL"),
    webVersion: process.env.WEB_VERSION?.trim().slice(0, 12) || undefined,
  };
}
