// Timed games expose the exact millisecond precision used to score and order a
// run. Keep live clocks, summaries, sharing, personal bests, and boards on the
// same three-decimal contract so the number never changes between surfaces.
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

// Kept as a semantic alias at leaderboard call sites: both paths deliberately
// render the same precision now.
export function formatLeaderboardSeconds(ms: number): string {
  return formatSeconds(ms)
}
