import { describe, expect, it } from 'vitest'
import {
  gamePathForRoute,
  gameReturnPathFromRoute,
  loginRouteForGame,
  profileRouteForGame,
  boardRouteForMode,
  boardModeFromRoute
} from '../../src/lib/game-routes'

describe('authenticated game routes', () => {
  it('recognizes every game path without treating public screens as games', () => {
    expect(gamePathForRoute('/surge')).toBe('/surge')
    expect(gamePathForRoute('/higher-lower?round=2')).toBe('/higher-lower')
    expect(gamePathForRoute('/leaderboards')).toBeUndefined()
  })

  it('round-trips a game through login and rejects external return paths', () => {
    const loginRoute = loginRouteForGame('/higher-lower')
    expect(loginRoute).toBe('/login?returnTo=%2Fhigher-lower')
    expect(gameReturnPathFromRoute(loginRoute)).toBe('/higher-lower')
    expect(gameReturnPathFromRoute('/login?returnTo=https%3A%2F%2Fexample.com')).toBeUndefined()
    expect(profileRouteForGame('/surge')).toBe('/profile?returnTo=%2Fsurge')
    expect(gameReturnPathFromRoute(profileRouteForGame('/surge'))).toBe('/surge')
  })

  // Desktop's mode rows read the board rather than starting a run, so the
  // Ladder has to be openable ON a board rather than only at its default one.
  it('round-trips a mode through its board route', () => {
    const board = boardRouteForMode('rain')
    expect(board).toBe('/leaderboards?mode=rain')
    expect(boardModeFromRoute(board)).toBe('rain')
    expect(boardModeFromRoute('/leaderboards')).toBeUndefined()
  })
})
