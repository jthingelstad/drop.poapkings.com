import type { PlayerProfile } from "./types.js";

export interface DiscordWebhookPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  content: string;
}

interface LoginEvent {
  profile: PlayerProfile;
  newPlayer: boolean;
}

type DiscordFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

function playerLabel(profile: PlayerProfile): string {
  return profile.publicName || "unnamed player";
}

function gameCount(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "game" : "games"}`;
}

export function loginWebhookPayload(event: LoginEvent): DiscordWebhookPayload {
  const { profile } = event;
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    content: [
      "🔐 Login",
      event.newPlayer ? "new" : "returning",
      playerLabel(profile),
      gameCount(profile.totalGames),
      profile.playerTag || "no CR tag",
    ].join(" · "),
  };
}

export async function publishDiscordEvent(
  webhookUrl: string | undefined,
  payload: DiscordWebhookPayload,
  fetcher: DiscordFetch = fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.warn(
        `Discord event delivery failed with HTTP ${response.status}.`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(`Discord event delivery failed with ${reason}.`);
  }
}
