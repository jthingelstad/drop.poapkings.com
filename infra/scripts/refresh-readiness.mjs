import { setTimeout } from "node:timers/promises";

// The first read can serve the stored clock while its queued refresh runs.
// Keep the freshness requirement; give the worker a bounded readiness window.
export async function waitForFreshSeasonClock(
  readStats,
  {
    attempts = 31,
    intervalMs = 2_000,
    sleep = setTimeout,
    now = Date.now,
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const stats = await readStats();
    const season = stats.currentSeason;
    const age = now() - Date.parse(season?.clockUpdatedAt);
    if (
      season?.source === "clash-royale" &&
      Number.isSafeInteger(season.id) &&
      season.id > 0 &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 15 * 60_000
    )
      return stats;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error(
    "Clash Royale season clock did not become fresh after queued refresh",
  );
}
