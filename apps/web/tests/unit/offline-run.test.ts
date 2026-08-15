import { GAME_MODES, TRADE_LADDER, type GameMode, type RunChallenge } from '@elixir-drop/contracts'
import { describe, expect, it } from 'vitest'
import { allCards } from '../../src/lib/card-catalog'
import { isOfflineRun, localOfflineRun } from '../../src/lib/offline-run'

const byId = new Map(allCards.map((card) => [card.id, card]))

function seededRandom(seed: number) {
  let state = seed >>> 0
  return (upperBound: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state % upperBound
  }
}

function challenge(mode: GameMode, seed = 1): RunChallenge {
  return localOfflineRun(mode, Date.now(), seededRandom(seed)).challenge
}

describe('offline game runs', () => {
  it.each(GAME_MODES)('creates an unfinishable local %s run', (mode) => {
    const run = localOfflineRun(mode, 1_000, seededRandom(7))
    expect(run.mode).toBe(mode)
    expect(run.challenge.mode).toBe(mode)
    expect(run.runToken).toBe('')
    expect(isOfflineRun(run)).toBe(true)
    expect(Date.parse(run.expiresAt)).toBeGreaterThan(1_000 + 60 * 60 * 1_000)
  })

  it('never mistakes a server run for an offline run', () => {
    expect(isOfflineRun({ runId: 'b3f7c1d2-9a4e-4c11-8f2a-5d6e7f801234' })).toBe(false)
    expect(isOfflineRun(null)).toBe(false)
    expect(isOfflineRun(undefined)).toBe(false)
  })

  it('deals Surge, Practice, Survival, and Rain with the canonical shapes', () => {
    const surge = challenge('surge') as Extract<RunChallenge, { mode: 'surge' }>
    const practice = challenge('practice') as Extract<RunChallenge, { mode: 'practice' }>
    const survival = challenge('survival') as Extract<RunChallenge, { mode: 'survival' }>
    const rain = challenge('rain') as Extract<RunChallenge, { mode: 'rain' }>
    const canonical = allCards.map((card) => card.id).sort((left, right) => left - right)

    expect(surge.cardIds).toHaveLength(15)
    expect(new Set(surge.cardIds).size).toBe(15)
    expect([...practice.cardIds].sort((left, right) => left - right)).toEqual(canonical)
    expect([...survival.cardIds].sort((left, right) => left - right)).toEqual(canonical)
    expect(rain.cardIds).toHaveLength(250)
    expect(rain.cardIds.every((id, index) => index === 0 || id !== rain.cardIds[index - 1])).toBe(true)
  })

  it('deals 250 valid Higher / Lower pairs without immediate card repeats', () => {
    const higherLower = challenge('higher-lower', 19) as Extract<RunChallenge, { mode: 'higher-lower' }>
    expect(higherLower.pairs).toHaveLength(250)
    for (const [index, pair] of higherLower.pairs.entries()) {
      const [left, right] = pair.map((id) => byId.get(id)!)
      expect(left.elixir).not.toBe(right.elixir)
      if (index > 0) {
        const previous = new Set(higherLower.pairs[index - 1])
        expect(pair.some((id) => previous.has(id))).toBe(false)
      }
    }
  })

  it('deals the complete Trade ladder with answerable, non-repeating boards', () => {
    const trade = challenge('trade', 37) as Extract<RunChallenge, { mode: 'trade' }>
    const seen = new Set<number>()
    expect(trade.rounds).toHaveLength(TRADE_LADDER.length)
    for (const [index, round] of trade.rounds.entries()) {
      const board = TRADE_LADDER[index]!
      expect(round.blueIds).toHaveLength(board.blue)
      expect(round.redIds).toHaveLength(board.red)
      const ids = [...round.blueIds, ...round.redIds]
      expect(ids.every((id) => !seen.has(id))).toBe(true)
      ids.forEach((id) => seen.add(id))
      const total = (values: number[]) => values.reduce((sum, id) => sum + byId.get(id)!.elixir, 0)
      expect(total(round.redIds) - total(round.blueIds)).toBeGreaterThanOrEqual(-4)
      expect(total(round.redIds) - total(round.blueIds)).toBeLessThanOrEqual(4)
    }
  })
})
