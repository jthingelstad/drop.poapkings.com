import type { SiteStats } from "@elixir-drop/contracts";
import { HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { ACTIVITY_WINDOW_HOURS } from "../repository.js";
import { recentSeasons, seasonForDate, upcomingSeasons } from "../seasons.js";
import {
  clientIpHash,
  currentWarClock,
  sessionFor,
  type RouteContext,
} from "./context.js";

const SEASON_ID_PATTERN = /^\d{4}-\d{2}(?:-\d+)?$/;
// Public reads share one generous per-IP hourly budget.
const READ_LIMIT_PER_HOUR = 1200;

async function chargeRead({ event, repository }: RouteContext) {
  await repository.useRateLimit(
    "reads",
    clientIpHash(event),
    READ_LIMIT_PER_HOUR,
    60 * 60,
  );
}

// GET /leaderboards — the season board by default, best-ever with
// ?scope=all-time, or the signed-in player's current clan with ?scope=clan.
export async function getLeaderboards(context: RouteContext) {
  const { event, repository, config } = context;
  await chargeRead(context);
  const mode = event.queryStringParameters?.mode;
  if (!isGameMode(mode)) throw new HttpError(400, "Choose a valid game mode.");
  const now = new Date();
  const clock = await currentWarClock(repository);
  const currentSeason = seasonForDate(now, clock);
  // The period rail's chips: the current season and the months behind it. Only
  // the Boards scope (season/all-time) shows the rail, so the clan reply omits
  // it. Undefined CR numbers fall back to the raw id on the client.
  const seasons = recentSeasons(now, 12, clock);
  // All-time ranks a player's best-ever score per mode across every season;
  // season (default) keeps the existing per-season board untouched.
  if (event.queryStringParameters?.scope === "all-time") {
    const entries = await repository.allTimeLeaderboard(mode);
    return json(200, {
      mode,
      scope: "all-time",
      currentSeason,
      seasons,
      entries,
    });
  }
  if (event.queryStringParameters?.scope === "clan") {
    const session = sessionFor(event, config.sessionSecret, true);
    const profile = await repository.getProfile(session.sub);
    if (!profile)
      throw new HttpError(404, "Player profile not found.", "not_found");
    if (!profile.playerTag)
      throw new HttpError(
        409,
        "Add a Clash Royale player tag to see clan rankings.",
        "player_tag_required",
      );
    const crProfile = await repository.getCrProfile(profile.playerTag);
    if (!crProfile?.clan) {
      if (!crProfile || crProfile.status === "pending")
        throw new HttpError(
          409,
          "Drop is still loading your Clash Royale clan. Try again shortly.",
          "clan_profile_pending",
        );
      if (crProfile.status === "not_found")
        throw new HttpError(
          409,
          "That Clash Royale player tag was not found.",
          "player_tag_not_found",
        );
      if (crProfile.status === "unavailable")
        throw new HttpError(
          503,
          "Your Clash Royale clan is briefly unavailable. Try again.",
          "clan_profile_unavailable",
        );
      throw new HttpError(
        409,
        "Your Clash Royale profile is not currently in a clan.",
        "clan_membership_required",
      );
    }
    const entries = await repository.clanAllTimeLeaderboard(
      mode,
      crProfile.clan.tag,
    );
    return json(200, {
      mode,
      scope: "clan",
      clan: { tag: crProfile.clan.tag, name: crProfile.clan.name },
      currentSeason,
      entries,
    });
  }
  const seasonId = event.queryStringParameters?.season || currentSeason.id;
  if (!SEASON_ID_PATTERN.test(seasonId))
    throw new HttpError(400, "Season ID is invalid.");
  const entries = await repository.leaderboard(mode, seasonId);
  return json(200, {
    mode,
    scope: "season",
    seasonId,
    currentSeason,
    seasons,
    entries,
  });
}

// GET /seasons — the live season plus the next few, from the war clock.
export async function getSeasons(context: RouteContext) {
  await chargeRead(context);
  const now = new Date();
  const clock = await currentWarClock(context.repository);
  const current = seasonForDate(now, clock);
  return json(200, { current, upcoming: upcomingSeasons(now, 3, clock) });
}

// GET /activity — the recent-runs rail.
export async function getActivity(context: RouteContext) {
  const { event, repository } = context;
  await chargeRead(context);
  const currentSeason = seasonForDate(
    new Date(),
    await currentWarClock(repository),
  );
  const rawLimit = Number(event.queryStringParameters?.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), 25))
    : 8;
  const entries = await repository.recentActivity(currentSeason.id, limit);
  return json(200, {
    seasonId: currentSeason.id,
    windowHours: ACTIVITY_WINDOW_HOURS,
    entries,
  });
}

// GET /stats — site social proof plus the deployed web build id.
export async function getStats(context: RouteContext) {
  const { config, repository } = context;
  await chargeRead(context);
  const stats = await repository.globalStats();
  const response: SiteStats = {
    ...stats,
    currentSeason: seasonForDate(new Date(), await currentWarClock(repository)),
    ...(config.webVersion ? { webVersion: config.webVersion } : {}),
  };
  return json(200, response);
}
