import { describe, expect, it } from 'vitest'
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
