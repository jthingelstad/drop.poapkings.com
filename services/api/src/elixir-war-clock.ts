/** Game calendar from Elixir's platform API. These are policy boundaries,
 * never an observed opening borrowed from a particular clan's river race. */
import type { CrWarClock } from "@elixir-drop/contracts";
import { apiRequest, type ElixirMcpFetch } from "./elixir-mcp.js";
import type { Config } from "./config.js";
interface GameClock {
  source?: string;
  as_of?: string;
  season_id?: number;
  section_index?: number;
  period_index?: number;
  day_kind?: string;
  season_started_at?: string;
  season_ends_at?: string;
  day_started_at?: string;
  day_ends_at?: string;
}
export function toWarClock(payload: GameClock): CrWarClock {
  const {
    season_id: seasonId,
    section_index: sectionIndex,
    period_index: periodIndex,
  } = payload;
  const dates = [
    payload.as_of,
    payload.season_started_at,
    payload.season_ends_at,
    payload.day_started_at,
    payload.day_ends_at,
  ];
  if (
    payload.source !== "policy" ||
    [seasonId, sectionIndex, periodIndex].some(
      (v) => !Number.isSafeInteger(v) || Number(v) < 0,
    ) ||
    Number(sectionIndex) > 4 ||
    Number(periodIndex) > 34 ||
    Math.floor(Number(periodIndex) / 7) !== sectionIndex ||
    dates.some((v) => !v || !Number.isFinite(Date.parse(v))) ||
    !["war", "training"].includes(payload.day_kind ?? "")
  )
    throw new Error("Invalid Elixir game clock");
  const [asOf, start, end, dayStart, dayEnd] = dates.map((v) => Date.parse(v!));
  if (
    !(
      start! <= dayStart! &&
      dayStart! <= asOf! &&
      asOf! < dayEnd! &&
      dayEnd! <= end!
    ) ||
    dayEnd! - dayStart! !== 86400_000
  )
    throw new Error("Inconsistent Elixir game boundaries");
  const finalWeek = (end! - start!) / 604800_000 - 1;
  return {
    crSeasonId: seasonId!,
    sectionIndex: sectionIndex!,
    periodIndex: periodIndex!,
    periodType:
      payload.day_kind === "training"
        ? "training"
        : sectionIndex === finalWeek
          ? "colosseum"
          : "warDay",
    seasonStartsAt: payload.season_started_at!,
    seasonEndsAt: payload.season_ends_at!,
    dayStartsAt: payload.day_started_at!,
    dayEndsAt: payload.day_ends_at!,
    observedAt: payload.as_of!,
    clockSource: "policy",
  };
}
export async function fetchWarClockFromHub(
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey">,
  _receivedAt = new Date(),
  fetcher?: ElixirMcpFetch,
): Promise<CrWarClock> {
  return toWarClock(
    await apiRequest<GameClock>(
      { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey },
      "GET",
      "/game/clock",
      undefined,
      fetcher,
    ),
  );
}
