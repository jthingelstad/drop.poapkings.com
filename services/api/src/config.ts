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
  tinylyticsApiToken?: string;
  emailFrom: string;
  emailFromName: string;
  nameModelId: string;
  discordWebhookUrl?: string;
  // Private marker CloudFront overwrites onto origin requests. It lets the API
  // trust the viewer IP overwritten by the request function without trusting a
  // public forwarding header on direct execute-api requests.
  webOriginToken?: string;
  // The Elixir MCP hub: Drop reads recorded Clash Royale history from it
  // and keeps its player collection current there. Optional so the app
  // runs unwired; every call site treats an absent hub as a no-op.
  elixirMcpBaseUrl: string;
  elixirMcpKey?: string;
  elixirMcpCollectionSlug: string;
  // The clan whose river race defines the Clan Wars calendar Drop's
  // seasons follow. Read from the hub now, not polled from Supercell.
  warClockClanTag: string;
  // Dedicated private bucket for permanent, browser-composited run preview PNGs.
  // Optional only so reduced-entry-point and unit-test environments do not need
  // an unrelated bucket; publication fails closed when production omits it.
  shareAssetBucket?: string;
  // Current front-end build id (first 12 chars of the git sha), reported on
  // /stats so stale tabs can prompt a reload. Absent until a deploy sets it.
  webVersion?: string;
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function emailFrom(): string {
  return process.env.ELIXIR_DROP_EMAIL_FROM?.trim() || "elixir@poapkings.com";
}

export function emailFromName(): string {
  return process.env.ELIXIR_DROP_EMAIL_FROM_NAME?.trim() || "Elixir Drop";
}

/**
 * Child mailbox of Sent that Drop files its outbound mail into.
 *
 * The Fastmail account is shared by several agents and uses a per-agent scheme
 * (Elixir-Sent, Oliver-Sent, Otto-Sent, Thingy-Sent). Only the top-level Sent
 * carries the JMAP `sent` role, so resolving by role alone dumps Drop's magic
 * links into the shared Sent folder. Default is correct on its own — no
 * CloudFormation parameter is needed (and adding one risks the param-wipe trap).
 */
export function emailSentFolder(): string {
  return process.env.ELIXIR_DROP_EMAIL_SENT_FOLDER?.trim() || "Elixir-Sent";
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
    tinylyticsApiToken: process.env.TINYLYTICS_API_TOKEN?.trim() || undefined,
    emailFrom: emailFrom(),
    emailFromName: emailFromName(),
    nameModelId:
      process.env.NAME_MODEL_ID?.trim() ||
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    discordWebhookUrl:
      process.env.ELIXIR_DROP_DISCORD_WEBHOOK_URL?.trim() || undefined,
    webOriginToken:
      process.env.ELIXIR_DROP_WEB_ORIGIN_TOKEN?.trim() || undefined,
    elixirMcpBaseUrl: (
      process.env.ELIXIR_MCP_BASE_URL?.trim() || "https://elixir.poapkings.com"
    ).replace(/\/$/, ""),
    elixirMcpKey: process.env.ELIXIR_MCP_KEY?.trim() || undefined,
    elixirMcpCollectionSlug:
      process.env.ELIXIR_MCP_COLLECTION_SLUG?.trim() || "elixir-drop",
    warClockClanTag:
      process.env.CR_WAR_CLOCK_CLAN_TAG?.trim().toUpperCase() || "#J2RGCRVG",
    shareAssetBucket: process.env.SHARE_ASSET_BUCKET?.trim() || undefined,
    webVersion: process.env.WEB_VERSION?.trim().slice(0, 12) || undefined,
  };
}

let cachedConfig: Config | undefined;

// The API's config, resolved on the container's first request and reused for
// every warm one after it — not re-derived per request.
export function loadConfig(): Config {
  cachedConfig ??= getConfig();
  return cachedConfig;
}
