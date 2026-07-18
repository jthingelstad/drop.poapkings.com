import { favoriteCard } from "./cards.js";
import { MODE_RULES } from "./games.js";
import { levelForGames } from "./progression.js";
import type { GameMode, PlayerProfile } from "./types.js";

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  color: number;
  timestamp: string;
  fields: DiscordField[];
  footer: { text: string };
}

export interface DiscordWebhookPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  embeds: DiscordEmbed[];
}

interface LoginEvent {
  profile: PlayerProfile;
  newPlayer: boolean;
  occurredAt: string;
  requestId: string;
  userAgent?: string;
}

interface CompletedGameEvent {
  authenticated: boolean;
  runId: string;
  mode: GameMode;
  score: number;
  seasonId: string;
  completedAt: string;
  profile?: PlayerProfile;
}

type DiscordFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

function field(name: string, value: unknown, inline = true): DiscordField {
  const text = String(value ?? "Unknown").trim() || "Unknown";
  return { name, value: text.slice(0, 1_024), inline };
}

function modeName(mode: GameMode): string {
  return mode
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function scoreText(mode: GameMode, score: number): string {
  const unit = MODE_RULES[mode].scoreUnit;
  if (unit === "milliseconds") return `${(score / 1_000).toFixed(3)} seconds`;
  if (unit === "percent") return `${score}%`;
  return score.toLocaleString("en-US");
}

function profileFields(profile: PlayerProfile): DiscordField[] {
  const progress = levelForGames(profile.totalGames);
  const card = favoriteCard(profile.favoriteCardId);
  return [
    field("Email", profile.email),
    field("Player ID", profile.playerId),
    field("Player Name", profile.publicName || "Not chosen"),
    field("Favorite Card", card?.name || "Not chosen"),
    field("CR Player Tag", profile.playerTag || "Not attached"),
    field("Progress", `${profile.totalGames} games · Level ${progress.level}`),
  ];
}

export function loginWebhookPayload(event: LoginEvent): DiscordWebhookPayload {
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Player Login",
        color: 0xf5c84c,
        timestamp: event.occurredAt,
        fields: [
          field(
            "Login Type",
            event.newPlayer ? "New player" : "Returning player",
          ),
          ...profileFields(event.profile),
          field("Client", event.userAgent || "Unknown", false),
          field("Request ID", event.requestId, false),
        ],
        footer: { text: "Elixir Drop · Login" },
      },
    ],
  };
}

export function completedGameWebhookPayload(
  event: CompletedGameEvent,
): DiscordWebhookPayload {
  const playerFields = event.profile
    ? profileFields(event.profile)
    : [field("Player", "Anonymous", false)];
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Game Finished",
        color: 0x6d28d9,
        timestamp: event.completedAt,
        fields: [
          field("Mode", modeName(event.mode)),
          field("Score", scoreText(event.mode, event.score)),
          field("Authenticated", event.authenticated ? "Yes" : "No"),
          ...playerFields,
          field("Season", event.seasonId),
          field("Run ID", event.runId, false),
        ],
        footer: { text: "Elixir Drop · Completed Game" },
      },
    ],
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
