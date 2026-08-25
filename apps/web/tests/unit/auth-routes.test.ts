import { describe, expect, it } from 'vitest'
import { ladderRoutePath, ladderRouteState, profileRouteForScope, youScopeFromRoute } from '@elixir-drop/contracts'
import {
  authReturnPathFromRoute,
  gamePathForRoute,
  gameReturnPathFromRoute,
  loginRouteForGame,
  loginRouteForReturnPath,
  profileRouteForGame,
  canonicalProfileRoute,
  boardRouteForMode,
  boardModeFromRoute
} from '../../src/lib/game-routes'
import { publicProfilePath, publicProfileScopeFromRoute } from '../../src/lib/public-player'

describe('authenticated game routes', () => {
  it('recognizes every game path without treating public screens as games', () => {
    expect(gamePathForRoute('/surge')).toBe('/surge')
    expect(gamePathForRoute('/higher-lower?round=2')).toBe('/higher-lower')
    expect(gamePathForRoute('/surgeon')).toBeUndefined()
    expect(gamePathForRoute('/surge/extra')).toBeUndefined()
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

  it('round-trips only the exact player-tag editor through authentication', () => {
    const loginRoute = loginRouteForReturnPath('/profile?edit=player-tag')
    expect(loginRoute).toBe('/login?returnTo=%2Fprofile%3Fedit%3Dplayer-tag')
    expect(authReturnPathFromRoute(loginRoute)).toBe('/profile?edit=player-tag')
    expect(gameReturnPathFromRoute(loginRoute)).toBeUndefined()
    expect(authReturnPathFromRoute('/login?returnTo=%2Fprofile')).toBeUndefined()
    expect(authReturnPathFromRoute('/login?returnTo=%2Fprofile%3Fedit%3Dplayer-tag%26next%3D%2Fadmin')).toBeUndefined()
  })

  // Desktop's mode rows read the board rather than starting a run, so the
  // Ladder has to be openable ON a board rather than only at its default one.
  it('round-trips a mode through its board route', () => {
    const board = boardRouteForMode('rain')
    expect(board).toBe('/leaderboards?mode=rain')
    expect(boardModeFromRoute(board)).toBe('rain')
    expect(boardModeFromRoute('/leaderboards')).toBeUndefined()
  })

  it('round-trips every Ladder control with Clash season numbers only', () => {
    const state = ladderRouteState('/leaderboards?scope=xp&mode=survival&season=134')
    expect(state).toEqual({ scope: 'xp', mode: 'survival', period: 134 })
    expect(ladderRoutePath(state)).toBe('/leaderboards?scope=xp&mode=survival&season=134')
    expect(ladderRouteState('/leaderboards?mode=rain&period=all-time&season=134')).toEqual({
      scope: 'boards',
      mode: 'rain',
      period: 'all-time'
    })
    expect(ladderRouteState('/leaderboards?season=2026-08')).toEqual({
      scope: 'boards',
      mode: 'surge',
      period: 'current'
    })
  })

  it('round-trips You and public-player scopes', () => {
    expect(youScopeFromRoute('/profile?scope=updates')).toBe('updates')
    expect(profileRouteForScope('account')).toBe('/profile?scope=account')
    expect(publicProfileScopeFromRoute('/players/player-2?scope=log')).toBe('log')
    expect(publicProfilePath('player 2', 'xp')).toBe('/players/player%202?scope=xp')
  })

  it('canonicalizes Profile scopes and exact flow capabilities', () => {
    expect(canonicalProfileRoute('/profile?scope=log')).toBe('/profile')
    expect(canonicalProfileRoute('/profile?scope=settings')).toBe('/profile?scope=settings')
    expect(canonicalProfileRoute('/profile?edit=player-tag')).toBe('/profile?edit=player-tag')
    expect(canonicalProfileRoute('/profile?returnTo=/surge')).toBe('/profile?returnTo=%2Fsurge')
    expect(canonicalProfileRoute('/profile?edit=nope')).toBe('/profile')
    expect(canonicalProfileRoute('/profile?returnTo=/surge?next=/admin')).toBe('/profile')
    expect(canonicalProfileRoute('/profile?edit=player-tag&scope=settings')).toBe('/profile?scope=settings')
    expect(canonicalProfileRoute('/profile?scope=settings&extra=1')).toBe('/profile?scope=settings')
  })

  it('carries scoped navigation through the sign-in round trip', () => {
    const ladder = '/leaderboards?scope=clan&mode=rain&season=135'
    expect(authReturnPathFromRoute(loginRouteForReturnPath(ladder))).toBe(ladder)
    const settings = '/profile?scope=settings'
    expect(authReturnPathFromRoute(loginRouteForReturnPath(settings))).toBe(settings)
  })
})
