/**
 * Player enrichment from the hub.
 *
 * Drop shows a player's Clash Royale name, clan and account age. Those
 * used to arrive by writing a job to SQS, waiting for the fixed-IP
 * bridge to call Supercell, and consuming the result from a second
 * queue. Elixir MCP already holds a live passthrough behind the shared
 * recording budget, so the round trip is now one call.
 *
 * The normalization below deliberately mirrors what the bridge did, so
 * the stored snapshot shape does not move: same clan rules, same
 * account age from the YearsPlayed badge. The one difference is that
 * CARDS ARE NOT KEPT. Drop collected the whole card collection, shipped
 * it to the browser on every /me, and read it nowhere; the practice
 * mode that once dealt from it was removed in July 2026 and is
 * prohibited in CLAUDE.md and SPEC.md.
 */

import type {
  ClashRoyaleAccountAge,
  ClashRoyaleClan,
} from "@elixir-drop/contracts";
import { callTool, type ElixirMcpFetch } from "./elixir-mcp.js";
import type { Config } from "./config.js";

export interface HubPlayer {
  name: string;
  clan?: ClashRoyaleClan;
  accountAge?: ClashRoyaleAccountAge;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeClan(
  value: unknown,
  role: unknown,
): ClashRoyaleClan | undefined {
  const clan = record(value);
  const badgeId = nonnegativeInteger(clan?.badgeId);
  if (
    !clan ||
    typeof clan.tag !== "string" ||
    !clan.tag ||
    typeof clan.name !== "string" ||
    !clan.name ||
    badgeId === undefined
  )
    return undefined;
  return {
    tag: clan.tag,
    name: clan.name,
    badgeId,
    ...(typeof role === "string" && role ? { role } : {}),
  };
}

/** Account age is the YearsPlayed badge: progress is days played. */
function normalizeAccountAge(
  value: unknown,
): ClashRoyaleAccountAge | undefined {
  if (!Array.isArray(value)) return undefined;
  const badge = value
    .map(record)
    .find((candidate) => candidate?.name === "YearsPlayed");
  if (!badge) return undefined;
  const days = nonnegativeInteger(badge.progress);
  const years =
    days === undefined
      ? nonnegativeInteger(badge.level)
      : Math.floor(days / 365);
  if (days === undefined && years === undefined) return undefined;
  return { days, years };
}

export function normalizeHubPlayer(payload: unknown): HubPlayer {
  const player = record(payload);
  if (!player || typeof player.name !== "string" || !player.name)
    throw new Error("Elixir MCP returned an invalid player payload");
  return {
    name: player.name,
    clan: normalizeClan(player.clan, player.role),
    accountAge: normalizeAccountAge(player.badges),
  };
}

/**
 * One live read of a player through the hub.
 *
 * live_fetch is an allowlisted passthrough that spends the hub's own
 * recording budget, so it is rate limited and worth deduping — which
 * the 6-hour claim in cr-refresh.ts already does.
 */
export async function fetchPlayerFromHub(
  config: Config,
  tag: string,
  fetcher?: ElixirMcpFetch,
): Promise<HubPlayer> {
  const response = await callTool<{ data?: unknown }>(
    { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey },
    "live_fetch",
    { path: `/players/${encodeURIComponent(tag)}` },
    fetcher,
  );
  return normalizeHubPlayer(response.data);
}
