// Display helpers for elapsed time (Surge headline + share line). Golf-time
// modes report to the hundredth of a second — a speed game where sub-100ms gaps
// decide a run should not round them away.
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2)
}
