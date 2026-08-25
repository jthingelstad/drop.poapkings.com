import { describe, expect, it } from 'vitest'
import {
  buildPracticeRecoveryCode,
  localLearningTotals,
  practiceRecoveryDelta,
  practiceRecoveryState,
  serializePracticeRecoveryCode,
  serverLearningTotals
} from '../../src/lib/practice-recovery'

describe('Practice recovery evidence', () => {
  it('builds the operator inputs from device and saved learning totals', () => {
    const local = localLearningTotals({
      '26000000': { seen: 2500, correct: 2000, missStreak: 0, lastSeen: 1 },
      '26000001': { seen: 500, correct: 350, missStreak: 1, lastSeen: 2 }
    })
    const server = serverLearningTotals({
      '3': { seen: 250, correct: 190 },
      '4': { seen: 150, correct: 110 }
    })
    const code = buildPracticeRecoveryCode(
      '22222222-2222-4222-8222-222222222222',
      local,
      server,
      '2026-08-25T18:45:00.000Z'
    )

    expect(code).toEqual({
      version: 1,
      playerId: '22222222-2222-4222-8222-222222222222',
      observedAt: '2026-08-25T18:45:00.000Z',
      localSeen: 3000,
      localCorrect: 2350,
      serverSeen: 400,
      serverCorrect: 300
    })
    expect(practiceRecoveryDelta(code)).toEqual({ seen: 2600, correct: 2050 })
    expect(practiceRecoveryState(code)).toBe('found')
    expect(JSON.parse(serializePracticeRecoveryCode(code))).toEqual(code)
  })

  it('distinguishes a synchronized device from inconsistent evidence', () => {
    const clear = buildPracticeRecoveryCode('player', { seen: 20, correct: 15 }, { seen: 20, correct: 15 })
    expect(practiceRecoveryState(clear)).toBe('clear')

    const inconsistent = buildPracticeRecoveryCode('player', { seen: 10, correct: 8 }, { seen: 20, correct: 15 })
    expect(practiceRecoveryState(inconsistent)).toBe('inconsistent')
  })

  it('ignores malformed local counters instead of emitting invalid operator evidence', () => {
    const local = localLearningTotals({
      bad: { seen: Number.NaN, correct: -4, missStreak: 0, lastSeen: 0 }
    })
    expect(local).toEqual({ seen: 0, correct: 0 })
  })
})
