// Display helpers for elapsed time (Surge headline + share line).
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}
