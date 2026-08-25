import {
  ladderRoutePath,
  ladderRouteState,
  normalizeAuthReturnPath,
  PLAYER_TAG_RETURN_PATH,
  profileRouteForScope,
  youScopeFromRoute,
  type AuthReturnPath
} from '@elixir-drop/contracts'
import { routePathname, routeQuery } from './router'

// The launch six (Rain joined as a ranked mode).
export const GAME_PATHS = ['/practice', '/surge', '/higher-lower', '/trade', '/survival', '/rain'] as const

export type GamePath = (typeof GAME_PATHS)[number]

export function gamePathForRoute(value: string): GamePath | undefined {
  const pathname = routePathname(value)
  return GAME_PATHS.find((path) => pathname === path)
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

export function canonicalProfileRoute(value: string): string {
  const params = new URLSearchParams(routeQuery(value))
  if (params.size === 1 && params.get('edit') === 'player-tag') return PLAYER_TAG_RETURN_PATH

  if (params.size === 1) {
    const returnTo = normalizeAuthReturnPath(params.get('returnTo'))
    const gamePath = returnTo ? gamePathForRoute(returnTo) : undefined
    if (gamePath) return profileRouteForGame(gamePath)
  }

  return profileRouteForScope(youScopeFromRoute(value))
}

// The Ladder, opened on one mode's board. Desktop's mode rows read rather than
// play, so they need a destination that arrives on the right board instead of
// the default one.
export function boardRouteForMode(mode: string): string {
  const state = ladderRouteState(`/leaderboards?mode=${encodeURIComponent(mode)}`)
  return ladderRoutePath(state)
}

export function boardModeFromRoute(value: string): string | undefined {
  const state = ladderRouteState(value)
  return state.mode === 'surge' && !new URLSearchParams(routeQuery(value)).has('mode') ? undefined : state.mode
}

export function gameReturnPathFromRoute(value: string): GamePath | undefined {
  const returnTo = authReturnPathFromRoute(value)
  return returnTo ? gamePathForRoute(returnTo) : undefined
}

export function authReturnPathFromRoute(value: string): AuthReturnPath | undefined {
  const returnTo = new URLSearchParams(routeQuery(value)).get('returnTo')
  return normalizeAuthReturnPath(returnTo)
}
