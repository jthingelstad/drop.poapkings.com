import type { CrPlayerRefreshResult } from "@elixir-drop/contracts";

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  embeds: Array<{
    title: string;
    color: number;
    timestamp: string;
    fields: DiscordField[];
    footer: { text: string };
  }>;
}

type DiscordFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

function field(name: string, value: unknown, inline = true): DiscordField {
  return {
    name,
    value: String(value ?? "Unknown").slice(0, 1_024),
    inline,
  };
}

function roleLabel(role: string | undefined): string | undefined {
  if (!role) return undefined;
  if (role === "coLeader") return "Co-leader";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function playerPulledWebhookPayload(
  result: CrPlayerRefreshResult,
  durationMs: number,
): DiscordPayload {
  const fields: DiscordField[] = [
    field("Player Tag", result.playerTag),
    field("Outcome", result.outcome === "success" ? "Loaded" : "Not found"),
    field("Fetch Time", `${durationMs.toLocaleString("en-US")} ms`),
  ];
  if (result.outcome === "success") {
    const { player } = result;
    fields.push(
      field("CR Player", player.name),
      field(
        "Clan",
        player.clan
          ? `${player.clan.name}${roleLabel(player.clan.role) ? ` · ${roleLabel(player.clan.role)}` : ""}`
          : "No clan",
      ),
      field(
        "Account Age",
        player.accountAge?.years === undefined
          ? "Not available"
          : `${player.accountAge.years} years`,
      ),
      field(
        "Card Collection",
        `${player.cards.length} ${player.cards.length === 1 ? "card" : "cards"}`,
      ),
    );
  }
  fields.push(field("Job ID", result.jobId, false));
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Clash Royale Player Loaded",
        color: result.outcome === "success" ? 0x6d28d9 : 0xef4444,
        timestamp: result.completedAt,
        fields,
        footer: { text: "Elixir Drop · CR Bridge" },
      },
    ],
  };
}

export async function publishPlayerPulledEvent(
  webhookUrl: string | undefined,
  result: CrPlayerRefreshResult,
  durationMs: number,
  fetcher: DiscordFetch = fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(playerPulledWebhookPayload(result, durationMs)),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok)
      console.warn(`Discord bridge event failed with HTTP ${response.status}.`);
  } catch (error) {
    console.warn(
      `Discord bridge event failed with ${error instanceof Error ? error.name : "UnknownError"}.`,
    );
  }
}
