import { describe, expect, it } from 'vitest'
import { allCards } from '../../src/lib/card-catalog'
import {
  dealLedgerSequence,
  formatLedgerBalance,
  isFluentCard,
  ledgerSequenceLength,
  ledgerStage
} from '../../src/lib/ledger'
import { emptyLedgerStats } from '../../src/lib/storage'

function seededRandom(seed: number) {
  let state = seed >>> 0
  return (upperBound: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state % upperBound
  }
}

describe('Ledger learning model', () => {
  it('graduates from guided to faded to tracked using unassisted evidence', () => {
    const guided = emptyLedgerStats()
    expect(ledgerStage(guided)).toBe('guided')
    expect(ledgerSequenceLength(guided)).toBe(2)

    const faded = { ...guided, checks: 5, unassistedChecks: 6, unassistedCorrect: 5 }
    expect(ledgerStage(faded)).toBe('faded')
    expect(ledgerSequenceLength(faded)).toBe(4)

    const tracked = { ...faded, checks: 17, unassistedChecks: 12, unassistedCorrect: 9 }
    expect(ledgerStage(tracked)).toBe('tracked')
    expect(ledgerSequenceLength(tracked)).toBe(4)
    expect(ledgerSequenceLength({ ...tracked, unassistedChecks: 32, unassistedCorrect: 28 })).toBe(6)
  })

  it('deals unique two-sided sequences inside the signed answer range', () => {
    const stats = { ...emptyLedgerStats(), checks: 30, unassistedChecks: 22, unassistedCorrect: 19 }
    const sequence = dealLedgerSequence(allCards, stats, new Set(), seededRandom(41))
    const ids = sequence.plays.map((play) => play.cardId)

    expect(sequence.plays).toHaveLength(5)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(sequence.plays.map((play) => play.side))).toEqual(new Set(['blue', 'red']))
    expect(sequence.balance).toBe(sequence.redTotal - sequence.blueTotal)
    expect(Math.abs(sequence.balance)).toBeLessThanOrEqual(4)
  })

  it('only fades costs backed by fluent Cost Recall evidence', () => {
    const card = allCards[0]!
    expect(isFluentCard(card.id, {})).toBe(false)
    expect(
      isFluentCard(card.id, {
        [String(card.id)]: {
          seen: 5,
          correct: 5,
          recallSeen: 5,
          recallCorrect: 5,
          missStreak: 0,
          lastSeen: Date.now(),
          avgMs: 1_200,
          latencySamples: 5
        }
      })
    ).toBe(true)
  })

  it('speaks every balance from the Blue perspective', () => {
    expect(formatLedgerBalance(-3)).toBe('Red +3')
    expect(formatLedgerBalance(0)).toBe('Even')
    expect(formatLedgerBalance(2)).toBe('Blue +2')
  })
})
