import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export interface BridgeConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  crApiKey: string;
  warClockClanTag: string;
  discordWebhookUrl?: string;
  requestQueueName: string;
  resultQueueName: string;
}

function loadLocalEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "..", ".env"),
  ];
  const path = candidates.find(existsSync);
  if (path) loadEnvFile(path);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getBridgeConfig(): BridgeConfig {
  loadLocalEnv();
  return {
    region: required("AWS_REGION"),
    accessKeyId: required("ELIXIR_DROP_CR_BRIDGE_AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("ELIXIR_DROP_CR_BRIDGE_AWS_SECRET_ACCESS_KEY"),
    crApiKey: required("CR_API_KEY"),
    warClockClanTag:
      process.env.CR_WAR_CLOCK_CLAN_TAG?.trim().toUpperCase() || "#J2RGCRVG",
    discordWebhookUrl:
      process.env.ELIXIR_DROP_DISCORD_WEBHOOK_URL?.trim() || undefined,
    requestQueueName:
      process.env.ELIXIR_DROP_CR_REQUEST_QUEUE_NAME?.trim() ||
      "elixir-drop-cr-requests",
    resultQueueName:
      process.env.ELIXIR_DROP_CR_RESULT_QUEUE_NAME?.trim() ||
      "elixir-drop-cr-results",
  };
}
