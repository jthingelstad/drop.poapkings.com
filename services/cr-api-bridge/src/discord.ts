import type { CrPlayerRefreshResult } from "@elixir-drop/contracts";

interface DiscordPayload {
  username: string;
  allowed_mentions: { parse: string[] };
  content: string;
}

type DiscordFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export function bridgeStartedWebhookPayload(processId: number): DiscordPayload {
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    content: `🟢 CR bridge online · process ${processId}`,
  };
}

function accountAge(result: CrPlayerRefreshResult): string {
  if (result.outcome !== "success") return "";
  const days = result.player.accountAge?.days;
  if (days !== undefined) {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    const value = [
      ...(years ? [`${years}y`] : []),
      ...(remainingDays || !years ? [`${remainingDays}d`] : []),
    ].join(" ");
    return `${value} account`;
  }
  const years = result.player.accountAge?.years;
  if (years === undefined) return "age unavailable";
  return `${years}y account`;
}

export function playerPulledWebhookPayload(
  result: CrPlayerRefreshResult,
  durationMs: number,
): DiscordPayload {
  if (result.outcome === "not_found") {
    return {
      username: "Elixir Drop Events",
      allowed_mentions: { parse: [] },
      content: `⚠️ CR not found · ${result.playerTag} · ${durationMs.toLocaleString("en-US")}ms`,
    };
  }
  return {
    username: "Elixir Drop Events",
    allowed_mentions: { parse: [] },
    content: [
      "🔄 CR loaded",
      `${result.player.name} (${result.playerTag})`,
      result.player.clan?.name || "no clan",
      `${result.player.cards.length} ${result.player.cards.length === 1 ? "card" : "cards"}`,
      accountAge(result),
      `${durationMs.toLocaleString("en-US")}ms`,
    ].join(" · "),
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

export async function publishBridgeStartedEvent(
  webhookUrl: string | undefined,
  processId: number,
  fetcher: DiscordFetch = fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bridgeStartedWebhookPayload(processId)),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok)
      console.warn(
        `Discord bridge startup event failed with HTTP ${response.status}.`,
      );
  } catch (error) {
    console.warn(
      `Discord bridge startup event failed with ${error instanceof Error ? error.name : "UnknownError"}.`,
    );
  }
}
