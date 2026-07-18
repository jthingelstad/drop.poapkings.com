import { describe, expect, it, vi } from 'vitest'
import { sampleCard, sampleUnseenCard } from '../../src/lib/sampling'
import {
  getCardStats,
  getFunnel,
  getRecords,
  getSettings,
  saveFunnel,
  saveRecords,
  saveResult,
  saveSettings
} from '../../src/lib/storage'
import type { Card } from '../../src/types'

const cards: Card[] = [
  { id: 1, name: 'One', elixir: 1, rarity: 'common', type: 'troop', evo: false, hero: false, icon: '/one.png' },
  { id: 2, name: 'Two', elixir: 2, rarity: 'common', type: 'spell', evo: false, hero: false, icon: '/two.png' }
]

describe('storage seam', () => {
  it('round-trips settings, records, funnel, and card stats', () => {
    saveSettings({ inputStyle: 'choice', sound: true, reducedMotion: true })
    expect(getSettings()).toMatchObject({ inputStyle: 'choice', sound: true, reducedMotion: true })

    saveRecords({
      surgeBest: 28_600,
      longestStreak: 9,
      identifyBest: 21_400,
      ladderBest: 12_300,
      tradeBest: 8_900
    })
    expect(getRecords()).toMatchObject({
      surgeBest: 28_600,
      longestStreak: 9,
      identifyBest: 21_400,
      ladderBest: 12_300,
      tradeBest: 8_900
    })

    saveFunnel({ recruitShown: getFunnel().recruitShown + 1, shares: 2 })
    expect(getFunnel()).toMatchObject({ recruitShown: 1, shares: 2 })

    saveResult(1, false, 1200)
    saveResult(1, true, 800)
    expect(getCardStats()['1']).toMatchObject({ seen: 2, correct: 1, missStreak: 0, avgMs: 1000 })
  })
})

describe('weighted sampler', () => {
  it('favors a recently missed card while keeping mastered cards selectable', () => {
    saveResult(1, false)
    saveResult(1, false)
    saveResult(2, true)
    saveResult(2, true)
    saveResult(2, true)

    vi.spyOn(Math, 'random').mockReturnValue(0.45)
    expect(sampleCard(cards, [])).toBe(cards[0])

    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    expect(sampleCard(cards, [])).toBe(cards[1])
  })

  it('penalizes recently seen cards instead of making them more likely', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)

    expect(sampleCard(cards, [cards[0].id])).toBe(cards[1])
  })

  it('samples unseen cards until the pool is exhausted', () => {
    const seen = new Set<number>()
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const first = sampleUnseenCard(cards, seen, [])
    const second = sampleUnseenCard(cards, seen, [])
    const third = sampleUnseenCard(cards, seen, [])

    expect(new Set([first.id, second.id])).toEqual(new Set([1, 2]))
    expect(third.id).toBe(1)
  })
})
