import { MODE_RULES } from "./games.js";
import type { CrProfileSnapshot, GameMode, PlayerProfile } from "./types.js";

export interface DiscordWebhookPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  content: string;
}

interface LoginEvent {
  profile: PlayerProfile;
  newPlayer: boolean;
}

interface CompletedGameEvent {
  runId: string;
  mode: GameMode;
  score: number;
  seasonId: string;
  completedAt: string;
  profile?: PlayerProfile;
  crProfile?: CrProfileSnapshot;
}

type DiscordFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

function modeName(mode: GameMode): string {
  return mode
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function scoreText(mode: GameMode, score: number): string {
  const unit = MODE_RULES[mode].scoreUnit;
  if (unit === "milliseconds") return `${(score / 1_000).toFixed(3)}s`;
  if (unit === "percent") return `${score}%`;
  return score.toLocaleString("en-US");
}

function playerLabel(profile: PlayerProfile): string {
  return profile.publicName || "unnamed player";
}

function gameCount(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "game" : "games"}`;
}

function clashRoyalePlayerLabels(event: CompletedGameEvent): string[] {
  const tag = event.profile?.playerTag;
  if (!tag) return [];
  const identity = event.crProfile?.name
    ? `${event.crProfile.name} (${tag})`
    : tag;
  return [
    identity,
    ...(event.crProfile?.clan?.name ? [event.crProfile.clan.name] : []),
  ];
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

export function completedGameWebhookPayload(
  event: CompletedGameEvent,
): DiscordWebhookPayload {
  const player = event.profile
    ? event.profile.publicName || "unnamed player"
    : "player";
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    content: [
      `🎮 ${modeName(event.mode)}`,
      scoreText(event.mode, event.score),
      player,
      ...clashRoyalePlayerLabels(event),
      ...(event.profile ? [gameCount(event.profile.totalGames)] : []),
      event.seasonId,
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
