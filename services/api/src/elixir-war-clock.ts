/**
 * The Clan Wars clock, from the hub.
 *
 * Drop's season boundaries and podium finalization key off the game's
 * own war clock. That used to mean the fixed-IP bridge polling two
 * Clash Royale endpoints every five minutes, forever, whether or not
 * anybody was playing: about 576 calls a day and Drop's single largest
 * consumer of Supercell.
 *
 * Elixir MCP already records POAP KINGS comprehensively and interprets
 * the same clock for its own war tools, so Drop reads that instead.
 * One authority for the calendar maths rather than two implementations
 * that can disagree.
 *
 * The anchor is better here, not merely cheaper. Drop derived the
 * season start from an ASSUMED 10:00 UTC reset, corrected by the last
 * river-race close; the hub reports when it actually OBSERVED the
 * period open. The daily reset drifts season to season, so an observed
 * boundary beats a calculated one.
 */

import type { ClanWarPeriodType, CrWarClock } from "@elixir-drop/contracts";
import { callTool, type ElixirMcpFetch } from "./elixir-mcp.js";
import type { Config } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

interface WarCurrent {
  clan_tag?: string;
  season_id?: number;
  section_index?: number;
  is_colosseum?: boolean;
  period?: {
    period_index?: number;
    kind?: string;
    started_observed_at?: string;
  };
}

function periodType(kind: unknown, isColosseum: unknown): ClanWarPeriodType {
  if (isColosseum === true) return "colosseum";
  if (kind === "training") return "training";
  if (kind === "war") return "warDay";
  throw new Error(
    `Elixir MCP returned an unknown war period kind: ${String(kind)}`,
  );
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`Elixir MCP returned an invalid ${label}`);
  return Number(value);
}

export function toWarClock(
  payload: WarCurrent,
  clanTag: string,
  observedAt = new Date(),
): CrWarClock {
  const sectionIndex = integer(payload.section_index, "section index");
  const periodIndex = integer(payload.period?.period_index, "period index");
  // The same sanity bound Drop always applied: a five-week season has at
  // most 5 sections of 7 periods, and a glitched index would back-date
  // the season start by months.
  if (sectionIndex > 5 || periodIndex > 34)
    throw new Error("Elixir MCP returned out-of-range Clan Wars indexes");

  const openedAt = payload.period?.started_observed_at
    ? new Date(payload.period.started_observed_at)
    : undefined;
  if (!openedAt || !Number.isFinite(openedAt.getTime()))
    throw new Error("Elixir MCP returned no observed period start");

  return {
    crSeasonId: integer(payload.season_id, "season id"),
    sectionIndex,
    periodIndex,
    periodType: periodType(payload.period?.kind, payload.is_colosseum),
    // Each period is one day, so the season opened periodIndex days
    // before this one did.
    seasonStartsAt: new Date(
      openedAt.getTime() - periodIndex * DAY_MS,
    ).toISOString(),
    observedAt: observedAt.toISOString(),
    sourceClanTag: payload.clan_tag ?? clanTag,
  };
}

export async function fetchWarClockFromHub(
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey" | "warClockClanTag">,
  observedAt = new Date(),
  fetcher?: ElixirMcpFetch,
): Promise<CrWarClock> {
  const payload = await callTool<WarCurrent>(
    { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey },
    "war_current",
    { clan_tag: config.warClockClanTag },
    fetcher,
  );
  return toWarClock(payload, config.warClockClanTag, observedAt);
}
