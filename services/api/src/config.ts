export interface Config {
  tableName: string;
  refreshQueueUrl?: string;
  sessionSecret: string;
  // Server-only pepper for the referee correlation HMACs (see
  // referee-evidence.ts). Guarded exactly like SESSION_SECRET: Lambda env only,
  // never in the referee scripts, the read-only role, CI, or the browser.
  telemetryPepper: string;
  appUrl: string;
  // Shared only by the fixed host and this Lambda. It authorizes the one
  // immediate player-Updates publication route without an AWS login.
  updatesPublishToken?: string;
  nameModelId: string;
  // Private marker CloudFront overwrites onto origin requests. It lets the API
  // trust the viewer IP overwritten by the request function without trusting a
  // public forwarding header on direct execute-api requests.
  webOriginToken?: string;
  // The Elixir hub: Drop reads recorded Clash Royale history from it.
  // Optional so the app
  // runs unwired; every call site treats an absent hub as a no-op.
  elixirMcpBaseUrl: string;
  // Sign in with Elixir: Drop's public OAuth client_id at Elixir's door.
  // Empty until registered (infra/scripts/register-elixir-client.mjs).
  elixirOAuthClientId: string;
  elixirOAuthClientSecret: string;
  elixirMcpKey?: string;
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

export function getConfig(): Config {
  return {
    tableName: required("TABLE_NAME"),
    refreshQueueUrl: process.env.REFRESH_QUEUE_URL?.trim() || undefined,
    sessionSecret: required("SESSION_SECRET"),
    telemetryPepper: required("TELEMETRY_PEPPER"),
    appUrl: required("APP_URL").replace(/\/$/, ""),
    updatesPublishToken:
      process.env.ELIXIR_DROP_UPDATES_PUBLISH_TOKEN?.trim() || undefined,
    nameModelId:
      process.env.NAME_MODEL_ID?.trim() ||
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    webOriginToken:
      process.env.ELIXIR_DROP_WEB_ORIGIN_TOKEN?.trim() || undefined,
    elixirMcpBaseUrl: (
      process.env.ELIXIR_MCP_BASE_URL?.trim() || "https://elixir.poapkings.com"
    ).replace(/\/$/, ""),
    elixirOAuthClientId: process.env.ELIXIR_OAUTH_CLIENT_ID?.trim() || "",
    elixirOAuthClientSecret:
      process.env.ELIXIR_OAUTH_CLIENT_SECRET?.trim() || "",
    elixirMcpKey:
      process.env.ELIXIR_INTEGRATION_KEY?.trim() ||
      process.env.ELIXIR_MCP_KEY?.trim() ||
      undefined,
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
