import { describe, expect, it } from 'vitest'
import { ALL_GAMES, featuredGame } from '../../src/screens/home/home-games'

describe('home games', () => {
  it('lists every ranked game, Surge included, in a fixed order', () => {
    expect(ALL_GAMES.map((game) => game.mode)).toEqual(['surge', 'higher-lower', 'rain', 'trade', 'survival'])
  })

  it('carries no NEW badge on any game', () => {
    expect(ALL_GAMES.filter((game) => game.badge)).toEqual([])
  })

  it('features one game per UTC day and cycles through all of them', () => {
    const week = Array.from(
      { length: ALL_GAMES.length },
      (_, offset) => featuredGame(new Date(Date.UTC(2026, 7, 10 + offset))).key
    )
    // Five distinct games across five days: the rotation reaches every mode.
    expect(new Set(week).size).toBe(ALL_GAMES.length)
    // And it repeats, so a regular can learn it.
    expect(featuredGame(new Date(Date.UTC(2026, 7, 15))).key).toBe(week[0])
  })

  it('is stable across a day regardless of the hour', () => {
    const morning = featuredGame(new Date(Date.UTC(2026, 7, 10, 0, 1)))
    const night = featuredGame(new Date(Date.UTC(2026, 7, 10, 23, 59)))
    expect(morning.key).toBe(night.key)
  })
})
