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
    expect(getCardStats()['1']).toMatchObject({
      seen: 2,
      correct: 1,
      missStreak: 0,
      recallSeen: 2,
      recallCorrect: 1,
      assistedSeen: 0,
      assistedCorrect: 0,
      avgMs: 1000,
      latencySamples: 2
    })
  })

  it('keeps requested help separate from recall accuracy and fluency', () => {
    saveResult(2, true, undefined, true)
    saveResult(2, false, undefined, true)
    saveResult(2, true, 900)

    expect(getCardStats()['2']).toMatchObject({
      seen: 3,
      correct: 2,
      recallSeen: 1,
      recallCorrect: 1,
      assistedSeen: 2,
      assistedCorrect: 1,
      avgMs: 900,
      latencySamples: 1
    })
  })

  it('does not reinterpret a retired Higher/Lower r2 best as an r3 record', () => {
    localStorage.setItem('elixirdrop:records', JSON.stringify({ higherLowerBest: 87 }))

    expect(getRecords().higherLowerContinuousBest).toBeUndefined()
  })
})
