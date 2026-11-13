/** Recorded player context from the Integration API, read with GET alone.
 * Drop writes nothing to Elixir (Jamie, 2026-11-12): it never asks Elixir
 * to refresh a profile. Elixir keeps the players on an account fresh itself,
 * and the source timestamp says how old a reading is. */

import type {
  ClashRoyaleAccountAge,
  ClashRoyaleClan,
} from "@elixir-drop/contracts";
import { apiGet, ElixirMcpError, type ElixirMcpFetch } from "./elixir-mcp.js";
import type { Config } from "./config.js";

export interface HubPlayer {
  name: string;
  observedAt?: string;
  clan?: ClashRoyaleClan;
  accountAge?: ClashRoyaleAccountAge;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

interface RecordedProfile {
  observed_at?: string;
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

/** The recorded profile, whatever its age. A player Elixir has not recorded
 * answers `not_recorded`; Drop asks for nothing more. */
export async function fetchPlayerFromHub(
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey">,
  tag: string,
  fetcher?: ElixirMcpFetch,
): Promise<HubPlayer> {
  const hub = { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey };
  const profile = await apiGet<RecordedProfile>(
    hub,
    `/players/${encodeURIComponent(tag)}`,
    fetcher,
  );
  const player = normalizeRecordedPlayer(profile);
  if (
    !player ||
    !profile.observed_at ||
    !Number.isFinite(Date.parse(profile.observed_at))
  )
    throw new ElixirMcpError(
      "Invalid recorded profile",
      502,
      "invalid_response",
    );
  return { ...player, observedAt: profile.observed_at };
}
