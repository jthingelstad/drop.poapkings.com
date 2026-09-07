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

interface RecordedProfile {
  name?: string;
  clan?: {
    clan_tag?: string;
    name?: string;
    badge_id?: number | null;
    role?: string | null;
  } | null;
  attributes?: {
    years_played?: number | null;
    account_age_days?: number | null;
  };
}

/**
 * The same three facts, from the hub's RECORDED history.
 *
 * Everything Drop renders is recorded now, so the ordinary path costs no
 * Clash Royale budget and no seconds on a login. Returns undefined when
 * the record cannot answer, which is the signal to fall back.
 */
export function normalizeRecordedPlayer(
  profile: RecordedProfile,
): HubPlayer | undefined {
  if (typeof profile.name !== "string" || !profile.name) return undefined;
  const clan = profile.clan;
  const badgeId = nonnegativeInteger(clan?.badge_id ?? undefined);
  const days = nonnegativeInteger(
    profile.attributes?.account_age_days ?? undefined,
  );
  const years = nonnegativeInteger(
    profile.attributes?.years_played ?? undefined,
  );
  return {
    name: profile.name,
    // Same rule as the live payload: a clan without its badge is half a
    // clan, and half a clan is not stored.
    clan:
      clan?.clan_tag && clan.name && badgeId !== undefined
        ? {
            tag: clan.clan_tag,
            name: clan.name,
            badgeId,
            ...(clan.role ? { role: clan.role } : {}),
          }
        : undefined,
    accountAge:
      days === undefined && years === undefined ? undefined : { days, years },
  };
}

/**
 * Read one player through the hub: the record first, live only if the
 * record cannot answer.
 *
 * A tag Drop has just been given is usually one the hub has never seen,
 * so the first read is live and the hub records that result
 * opportunistically. Every read after it comes from history: no
 * Supercell call, no seconds on the login path, for facts that change
 * about as often as somebody changes clan.
 */
export async function fetchPlayerFromHub(
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey">,
  tag: string,
  fetcher?: ElixirMcpFetch,
): Promise<HubPlayer> {
  const hub = { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey };
  try {
    const recorded = await callTool<RecordedProfile>(
      hub,
      "players_profile",
      { player_tag: tag },
      fetcher,
    );
    const player = normalizeRecordedPlayer(recorded);
    if (player) return player;
  } catch (error) {
    // not_recorded is the ordinary cold case, not a failure worth
    // logging every time somebody links a new tag.
    const code = (error as { code?: string }).code;
    if (code !== "not_recorded" && code !== "not_found") {
      console.warn("Elixir MCP recorded profile unavailable; reading live", {
        playerTag: tag,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const response = await callTool<{ data?: unknown }>(
    hub,
    "live_fetch",
    { path: `/players/${encodeURIComponent(tag)}` },
    fetcher,
  );
  return normalizeHubPlayer(response.data);
}
