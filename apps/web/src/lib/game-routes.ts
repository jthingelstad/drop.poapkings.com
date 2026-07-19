// The launch five. Vaulted mode paths (identify, blitz, ladder,
// endless-ladder, cost-sweep) are unrouted until their re-release drops.
export const GAME_PATHS = ['/practice', '/surge', '/higher-lower', '/trade', '/survival'] as const

export type GamePath = (typeof GAME_PATHS)[number]

export function gamePathForRoute(value: string): GamePath | undefined {
  const pathname = value.split('?')[0]
  return GAME_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function loginRouteForGame(path: GamePath): string {
  return `/login?returnTo=${encodeURIComponent(path)}`
}

export function profileRouteForGame(path: GamePath): string {
  return `/profile?returnTo=${encodeURIComponent(path)}`
}

export function gameReturnPathFromRoute(value: string): GamePath | undefined {
  const query = value.split('?')[1] || ''
  const returnTo = new URLSearchParams(query).get('returnTo')
  return returnTo ? gamePathForRoute(returnTo) : undefined
}
