import { describe, expect, it } from 'vitest'
import { getCardStats, getRecords, getSettings, saveRecords, saveResult, saveSettings } from '../../src/lib/storage'

describe('storage seam', () => {
  it('round-trips settings, records, and card stats', () => {
    saveSettings({ inputStyle: 'choice', sound: true, reducedMotion: true })
    expect(getSettings()).toMatchObject({ inputStyle: 'choice', sound: true, reducedMotion: true })

    saveRecords({
      surgeBest: 28_600,
      higherLowerContinuousBest: 9,
      tradeLadderBest: 8_900
    })
    expect(getRecords()).toMatchObject({
      surgeBest: 28_600,
      higherLowerContinuousBest: 9,
      tradeLadderBest: 8_900
    })

    saveResult(1, false, 1200)
    saveResult(1, true, 800)
    expect(getCardStats()['1']).toMatchObject({ seen: 2, correct: 1, missStreak: 0, avgMs: 1000 })
  })

  it('does not reinterpret a retired Higher/Lower r2 best as an r3 record', () => {
    localStorage.setItem('elixirdrop:records', JSON.stringify({ higherLowerBest: 87 }))

    expect(getRecords().higherLowerContinuousBest).toBeUndefined()
  })
})
