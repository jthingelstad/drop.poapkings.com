import { afterEach, describe, expect, it } from 'vitest'
import { NAV_ITEMS, activeNavIndex, isGameRoute } from '../../src/components/shell/nav'
import { seasonEndsLabel, surgeSeasonCallout } from '../../src/screens/home/home-data'
import { scoreLabel, gameDisplay, RANKED_GAMES, GAMES } from '../../src/lib/game-metadata'
import { installMode, installDismissed, dismissInstall } from '../../src/lib/pwa-install'
import type { Season } from '@elixir-drop/contracts'

describe('shell nav model', () => {
  it('keeps the Games tab active across the game routes', () => {
    expect(isGameRoute('/surge')).toBe(true)
    expect(isGameRoute('/rain')).toBe(true)
    expect(isGameRoute('/leaderboards')).toBe(false)
    expect(activeNavIndex('/surge')).toBe(0)
    expect(activeNavIndex('/')).toBe(0)
    expect(activeNavIndex('/leaderboards')).toBe(1)
    expect(activeNavIndex('/players/rival')).toBe(1)
    expect(activeNavIndex('/profile')).toBe(2)
    expect(NAV_ITEMS.map((item) => item.shortLabel)).toEqual(['Games', 'Ranks', 'You'])
  })

  // The "More" pages are opened from Profile, so the pill has to stay on You
  // while they are read. They matched no tab before, and activeNavIndex falls
  // back to 0, so opening About from the You tab slid the pill to Games.
  it('keeps the pill on You for every page reached from the More list', () => {
    for (const route of ['/about', '/releases', '/faq', '/fair-play', '/install', '/privacy', '/settings']) {
      expect(activeNavIndex(route)).toBe(2)
    }
    // The fallback still belongs to Games for genuinely unclaimed routes.
    expect(activeNavIndex('/nonsense')).toBe(0)
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

describe('Surge season callout', () => {
  const leader = {
    rank: 1,
    score: 12_800,
    achievedAt: '2026-08-02T00:00:00.000Z',
    player: { id: 'leader', publicName: 'Leader', totalGames: 10, xp: 100, level: 2 }
  }

  it('turns the score gap into an actionable free-pass message', () => {
    expect(surgeSeasonCallout([leader], 20_000, 'me')).toEqual({
      title: 'Get 7.2s faster to take the lead',
      detail: '#1 in Surge wins next season’s free pass.',
      leading: false
    })
  })

  it('recognizes the current leader', () => {
    expect(surgeSeasonCallout([leader], 12_800, 'leader')).toEqual({
      title: 'You lead the race for the free pass',
      detail: 'Hold #1 through the season finish.',
      leading: true
    })
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
    installDismissed.value = false
    try {
      localStorage.removeItem('elixirdrop:installDismissed')
    } catch {
      // ignore
    }
  })

  it('dismissing collapses the banner, keeps capability, and persists the choice', () => {
    installMode.value = 'ios'
    installDismissed.value = false
    dismissInstall()
    // Capability stays (a compact Home row + the Install page remain reachable);
    // only the prominent banner is dismissed, and the choice persists.
    expect(installMode.value).toBe('ios')
    expect(installDismissed.value).toBe(true)
    expect(localStorage.getItem('elixirdrop:installDismissed')).toBe('1')
  })
})
