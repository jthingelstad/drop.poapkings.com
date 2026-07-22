import { afterEach, describe, expect, it } from 'vitest'
import { NAV_ITEMS, activeNavIndex, isGameRoute } from '../../src/components/shell/nav'
import { seasonEndsLabel } from '../../src/screens/home/home-data'
import { scoreLabel, gameDisplay, RANKED_GAMES, GAMES } from '../../src/lib/game-metadata'
import { installMode, dismissInstall } from '../../src/lib/pwa-install'
import type { Season } from '@elixir-drop/contracts'

describe('shell nav model', () => {
  it('keeps the Games tab active across the game routes', () => {
    expect(isGameRoute('/surge')).toBe(true)
    expect(isGameRoute('/rain')).toBe(true)
    expect(isGameRoute('/leaderboards')).toBe(false)
    expect(activeNavIndex('/surge')).toBe(0)
    expect(activeNavIndex('/')).toBe(0)
    expect(activeNavIndex('/leaderboards')).toBe(1)
    expect(activeNavIndex('/profile')).toBe(2)
    expect(NAV_ITEMS.map((item) => item.shortLabel)).toEqual(['Games', 'Ranks', 'You'])
  })
})

describe('season-ends label', () => {
  const season = (endsAt: string): Season =>
    ({
      id: '2026-07',
      startsAt: '2026-07-06T10:00:00.000Z',
      endsAt,
      durationWeeks: 4
    }) as Season

  it('formats days, days+hours, and hour-only remaining', () => {
    // A half-hour buffer past each boundary so a few ms of test execution can't
    // drift the floored hour/day down.
    const future = new Date(Date.now() + (6 * 86_400_000 + 4 * 3_600_000 + 30 * 60_000)).toISOString()
    expect(seasonEndsLabel(season(future))).toBe('Season ends in 6d')
    expect(seasonEndsLabel(season(future), true)).toBe('Season ends in 6d 04h')
    const soon = new Date(Date.now() + (3 * 3_600_000 + 30 * 60_000)).toISOString()
    expect(seasonEndsLabel(season(soon))).toBe('Season ends in 3h')
    expect(seasonEndsLabel(null)).toBe('Season in progress')
  })
})

describe('rain is a ranked mode', () => {
  it('labels rain scores as cleared count and lists it as ranked', () => {
    expect(scoreLabel('rain', 44)).toBe('44 cleared')
    expect(gameDisplay('rain').name).toBe('Rain')
    expect(RANKED_GAMES.some((g) => g.mode === 'rain')).toBe(true)
    expect(GAMES.some((g) => g.mode === 'rain')).toBe(true)
  })
})

describe('install prompt state', () => {
  afterEach(() => {
    installMode.value = 'none'
    try {
      localStorage.removeItem('elixirdrop:installDismissed')
    } catch {
      // ignore
    }
  })

  it('dismissing hides the prompt and persists the choice', () => {
    installMode.value = 'ios'
    dismissInstall()
    expect(installMode.value).toBe('none')
    expect(localStorage.getItem('elixirdrop:installDismissed')).toBe('1')
  })
})
