// Display helpers for elapsed time (Surge headline + share line). Golf-time
// modes report to the hundredth of a second — a speed game where sub-100ms gaps
// decide a run should not round them away.
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2)
}

// Leaderboards expose the full millisecond precision used to order timed runs.
// Keep other game and sharing surfaces at the more compact hundredth above.
export function formatLeaderboardSeconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}
