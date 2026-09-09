import { setTimeout as delay } from "node:timers/promises";
/** Recorded player context from the Integration API. The source timestamp
 * drives cache freshness; missing/stale profiles request collector work. */

import type {
  ClashRoyaleAccountAge,
  ClashRoyaleClan,
} from "@elixir-drop/contracts";
import {
  apiRequest,
  ElixirMcpError,
  type ElixirMcpFetch,
} from "./elixir-mcp.js";
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

/** Read the record first. Missing or stale data starts an asynchronous refresh;
 * access refusals and outages never trigger extra upstream work. */
export async function fetchPlayerFromHub(
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey">,
  tag: string,
  fetcher?: ElixirMcpFetch,
  sleep: (ms: number) => Promise<void> = (ms) => delay(ms),
): Promise<HubPlayer> {
  const hub = { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey };
  const normalize = (profile: RecordedProfile): HubPlayer => {
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
  };
  try {
    const recorded = normalize(
      await apiRequest<RecordedProfile>(
        hub,
        "GET",
        `/players/${encodeURIComponent(tag)}`,
        undefined,
        fetcher,
      ),
    );
    if (Date.now() - Date.parse(recorded.observedAt!) < 6 * 60 * 60_000)
      return recorded;
  } catch (error) {
    // Authentication, quota and server failures are not missing player data.
    if (!(error instanceof ElixirMcpError) || error.code !== "not_recorded")
      throw error;
  }
  type Refresh = { id?: string; status: string; profile?: RecordedProfile };
  let refresh = await apiRequest<Refresh>(
    hub,
    "POST",
    "/profile-refreshes",
    { player_tag: tag },
    fetcher,
    `profile:${tag}:${Math.floor(Date.now() / (15 * 60_000))}`,
  );
  // Only the background worker calls this adapter. Give ordinary collector
  // work a short completion window before relying on the longer SQS retry.
  for (
    let attempt = 0;
    refresh.status === "pending" && attempt < 3;
    attempt += 1
  ) {
    if (!refresh.id || !/^[a-f0-9-]{36}$/.test(refresh.id))
      throw new ElixirMcpError(
        "Invalid refresh resource",
        502,
        "invalid_response",
      );
    await sleep(5000);
    refresh = await apiRequest<Refresh>(
      hub,
      "GET",
      `/profile-refreshes/${refresh.id}`,
      undefined,
      fetcher,
    );
  }
  if (refresh.status === "complete" && refresh.profile)
    return normalize(refresh.profile);
  // The durable FIFO worker retries. Do not pretend enrollment or an accepted
  // fetch means the recorder already holds an observation.
  throw new ElixirMcpError("Profile refresh pending", 202, "refresh_pending");
}
