import { describe, expect, it } from 'vitest'
import {
  gamePathForRoute,
  gameReturnPathFromRoute,
  loginRouteForGame,
  profileRouteForGame
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
})
