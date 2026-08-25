import { normalizeAuthReturnPath, type AuthReturnPath } from '@elixir-drop/contracts'

// The launch six (Rain joined as a ranked mode).
export const GAME_PATHS = ['/practice', '/surge', '/higher-lower', '/trade', '/survival', '/rain'] as const

export type GamePath = (typeof GAME_PATHS)[number]

export function gamePathForRoute(value: string): GamePath | undefined {
  const pathname = value.split('?')[0]
  return GAME_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function loginRouteForGame(path: GamePath): string {
  return loginRouteForReturnPath(path)
}

export function loginRouteForReturnPath(path: AuthReturnPath): string {
  return `/login?returnTo=${encodeURIComponent(path)}`
}

export function profileRouteForGame(path: GamePath): string {
  return `/profile?returnTo=${encodeURIComponent(path)}`
}

// The Ladder, opened on one mode's board. Desktop's mode rows read rather than
// play, so they need a destination that arrives on the right board instead of
// the default one.
export function boardRouteForMode(mode: string): string {
  return `/leaderboards?mode=${encodeURIComponent(mode)}`
}

export function boardModeFromRoute(value: string): string | undefined {
  const query = value.split('?')[1] || ''
  return new URLSearchParams(query).get('mode') ?? undefined
}

export function gameReturnPathFromRoute(value: string): GamePath | undefined {
  const returnTo = authReturnPathFromRoute(value)
  return returnTo ? gamePathForRoute(returnTo) : undefined
}

export function authReturnPathFromRoute(value: string): AuthReturnPath | undefined {
  const query = value.split('?')[1] || ''
  const returnTo = new URLSearchParams(query).get('returnTo')
  return normalizeAuthReturnPath(returnTo)
}
