export interface Config {
  tableName: string;
  sessionSecret: string;
  appUrl: string;
  jmapToken: string;
  emailFrom: string;
  emailFromName: string;
  nameModelId: string;
  discordWebhookUrl?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig(): Config {
  return {
    tableName: required("TABLE_NAME"),
    sessionSecret: required("SESSION_SECRET"),
    appUrl: required("APP_URL").replace(/\/$/, ""),
    jmapToken: required("FASTMAIL_JMAP_TOKEN"),
    emailFrom:
      process.env.ELIXIR_DROP_EMAIL_FROM?.trim() || "elixir@poapkings.com",
    emailFromName:
      process.env.ELIXIR_DROP_EMAIL_FROM_NAME?.trim() || "Elixir Drop",
    nameModelId: process.env.NAME_MODEL_ID?.trim() || "amazon.nova-micro-v1:0",
    discordWebhookUrl:
      process.env.ELIXIR_DROP_DISCORD_WEBHOOK_URL?.trim() || undefined,
  };
}
