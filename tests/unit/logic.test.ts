import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeChoices } from '../../src/lib/choices'
import { countTargetCards, isSweepComplete, remainingTargetIds, targetIds } from '../../src/lib/cost-sweep'
import { canInsertAt, insertAtSlot, validInsertSlots } from '../../src/lib/endless-ladder'
import { formatSeconds } from '../../src/lib/format'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { pickLine } from '../../src/lib/elixir-lines'
import { isAscendingByElixir, pickLadderHintCard, reorderCards } from '../../src/lib/ladder'
import { makeNameChoices } from '../../src/lib/name-choices'
import { identifySummaryLine, ladderSummaryLine, tradeSummaryLine } from '../../src/lib/mode-insights'
import { clearTimers, elapsedWithPenalty, schedule, startCountdown } from '../../src/lib/run-loop'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, type TradeRound } from '../../src/lib/trade'
import type { Card } from '../../src/types'

function card(id: number, name: string, elixir: number, type: Card['type'] = 'troop'): Card {
  return {
    id,
    name,
    elixir,
    type,
    rarity: 'common',
    evo: false,
    hero: false,
    icon: `https://example.com/${id}.png`
  }
}

describe('learning helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('builds adjacent elixir choices around the truth', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(new Set(makeChoices(1))).toEqual(new Set([1, 2, 3, 4]))
    expect(new Set(makeChoices(4))).toEqual(new Set([3, 4, 5, 6]))
    expect(new Set(makeChoices(10))).toEqual(new Set([7, 8, 9, 10]))
  })

  it('formats timed scores as one decimal second', () => {
    expect(formatSeconds(28_600)).toBe('28.6')
  })

  it('builds card-name choices with the target and nearby distractors', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const fireball = card(1, 'Fireball', 4, 'spell')
    const arrows = card(2, 'Arrows', 3, 'spell')
    const zap = card(3, 'Zap', 2, 'spell')
    const rocket = card(4, 'Rocket', 6, 'spell')
    const knight = card(5, 'Knight', 3)
    const cannon = card(6, 'Cannon', 3, 'building')

    const choices = makeNameChoices(fireball, [fireball, arrows, zap, rocket, knight, cannon], 4)

    expect(choices).toHaveLength(4)
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(4)
    expect(choices.map((choice) => choice.name)).toContain('Fireball')
    expect(choices.map((choice) => choice.name)).toContain('Arrows')
  })

  it('computes accuracy, weak cards, bias, and timing insight', () => {
    const knight = card(1, 'Knight', 3)
    const fireball = card(2, 'Fireball', 4, 'spell')
    const rocket = card(3, 'Rocket', 6, 'spell')
    const answers = [
      { card: knight, guess: 3, correct: true, ms: 700 },
      { card: fireball, guess: 6, correct: false, ms: 1800 },
      { card: fireball, guess: 5, correct: false, ms: 1600 },
      { card: rocket, guess: 8, correct: false, ms: 2500 }
    ]

    const insights = computeInsights(answers)

    expect(insights.total).toBe(4)
    expect(insights.correct).toBe(1)
    expect(insights.accuracyPct).toBe(25)
    expect(insights.weakest[0]).toBe(fireball)
    expect(insights.biasLine).toBe('you overestimate spells by ~2')
    expect(insights.slowestBandLabel).toBe('5+')
    expect(insightPhrase(insights)).toContain('cost cards')
  })

  it('writes mode-specific summary coaching', () => {
    const tesla = card(1, 'Tesla', 4, 'building')

    expect(
      identifySummaryLine({
        isPB: false,
        totalMs: 12_300,
        totalCards: 15,
        firstTry: 13,
        misses: 2,
        missedCards: [tesla]
      })
    ).toContain('Re-drill Tesla')

    expect(
      tradeSummaryLine({
        isPB: false,
        totalMs: 9_100,
        sequenceLen: 8,
        cleanTrades: 6,
        wrongGuesses: 2,
        lastTrade: -1
      })
    ).toContain('Blue spends more')

    expect(ladderSummaryLine({ isPB: false, totalMs: 6_700, wrongLocks: 2 })).toContain('2 lock misses')
    expect(ladderSummaryLine({ isPB: true, totalMs: 5_200, wrongLocks: 0 })).toContain('New Ladder best')
  })

  it('interpolates Elixir lines and returns empty for unknown events', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(pickLine('correct_streak', { n: 4 })).toContain('4')
    expect(pickLine('surge_done', { time: '28.6', insight: 'clean read' })).toContain('28.6')
    expect(pickLine('missing' as never)).toBe('')
  })

  it('validates and reorders Speed Ladder cards', () => {
    const knight = card(1, 'Knight', 3)
    const fireball = card(2, 'Fireball', 4, 'spell')
    const rocket = card(3, 'Rocket', 6, 'spell')

    expect(isAscendingByElixir([knight, fireball, rocket])).toBe(true)
    expect(isAscendingByElixir([fireball, knight, rocket])).toBe(false)
    expect(reorderCards([fireball, knight, rocket], 1, 0)).toEqual([knight, fireball, rocket])
  })

  it('validates Endless Ladder insertion slots', () => {
    const skeletons = card(1, 'Skeletons', 1)
    const knight = card(2, 'Knight', 3)
    const fireball = card(3, 'Fireball', 4, 'spell')
    const rocket = card(4, 'Rocket', 6, 'spell')
    const row = [skeletons, fireball, rocket]

    expect(canInsertAt(row, knight, 0)).toBe(false)
    expect(canInsertAt(row, knight, 1)).toBe(true)
    expect(canInsertAt(row, knight, 2)).toBe(false)
    expect(validInsertSlots(row, knight)).toEqual([1])
    expect(insertAtSlot(row, knight, 1)).toEqual([skeletons, knight, fireball, rocket])
  })

  it('tracks Cost Sweep targets and completion', () => {
    const skeletons = card(1, 'Skeletons', 1)
    const knight = card(2, 'Knight', 3)
    const archers = card(3, 'Archers', 3)
    const fireball = card(4, 'Fireball', 4, 'spell')
    const board = [skeletons, knight, archers, fireball]

    expect(targetIds(board, 3)).toEqual(new Set([knight.id, archers.id]))
    expect(countTargetCards(board, 3)).toBe(2)
    expect(remainingTargetIds(board, 3, new Set([knight.id]))).toEqual([archers.id])
    expect(isSweepComplete(board, 3, new Set([knight.id]))).toBe(false)
    expect(isSweepComplete(board, 3, new Set([knight.id, archers.id]))).toBe(true)
  })

  it('reveals Speed Ladder hint cards from the first ordering problem', () => {
    const knight = card(1, 'Knight', 3)
    const fireball = card(2, 'Fireball', 4, 'spell')
    const rocket = card(3, 'Rocket', 6, 'spell')
    const goblins = card(4, 'Goblins', 2)
    const order = [rocket, knight, fireball, goblins]

    expect(pickLadderHintCard(order, new Set())).toBe(knight.id)
    expect(pickLadderHintCard(order, new Set([knight.id]))).toBe(rocket.id)
    expect(pickLadderHintCard(order, new Set([knight.id, rocket.id]))).toBe(goblins.id)
    expect(pickLadderHintCard(order, new Set(order.map((c) => c.id)))).toBeUndefined()
  })

  it('scores Trade from the Blue King perspective', () => {
    const knight = card(1, 'Knight', 3)
    const fireball = card(2, 'Fireball', 4, 'spell')
    const rocket = card(3, 'Rocket', 6, 'spell')
    const round: TradeRound = { blue: [knight, fireball], red: [rocket] }

    expect(sideTotal(round.blue)).toBe(7)
    expect(sideTotal(round.red)).toBe(6)
    expect(tradeValue(round)).toBe(-1)
    expect(formatTrade(tradeValue(round))).toBe('-1')
    expect(formatTrade(0)).toBe('Even')
    expect(formatTrade(2)).toBe('+2')
  })

  it('runs countdowns, clears scheduled timers, and computes penalized elapsed time', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(2450)

    const timers: number[] = []
    const count = { value: 9 }
    const begin = vi.fn()

    startCountdown(count, begin, timers, 100)
    expect(count.value).toBe(3)
    expect(begin).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(count.value).toBe(2)
    vi.advanceTimersByTime(100)
    expect(count.value).toBe(1)
    vi.advanceTimersByTime(100)
    expect(begin).toHaveBeenCalledTimes(1)

    const scheduled = vi.fn()
    schedule(timers, scheduled, 100)
    clearTimers(timers)
    vi.advanceTimersByTime(100)
    expect(scheduled).not.toHaveBeenCalled()
    expect(timers).toHaveLength(0)
    expect(elapsedWithPenalty(1000, 2000)).toBe(3450)
  })

  it('reveals Trade hint cards by highest hidden elixir value', () => {
    const knight = card(1, 'Knight', 3)
    const fireball = card(2, 'Fireball', 4, 'spell')
    const rocket = card(3, 'Rocket', 6, 'spell')
    const round: TradeRound = { blue: [knight, rocket], red: [fireball] }

    expect(pickTradeHintCard(round, new Set())).toBe(rocket.id)
    expect(pickTradeHintCard(round, new Set([rocket.id]))).toBe(fireball.id)
    expect(pickTradeHintCard(round, new Set([rocket.id, fireball.id]))).toBe(knight.id)
    expect(pickTradeHintCard(round, new Set([rocket.id, fireball.id, knight.id]))).toBeUndefined()
  })
})
