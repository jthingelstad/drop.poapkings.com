import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardNameToneClass, cardRarityLabel, cardRarityModifier } from '../../src/lib/card-rendering'
import { makeChoices } from '../../src/lib/choices'
import { formatSeconds } from '../../src/lib/format'
import { challengePreparers } from '../../src/lib/game-challenge-content'
import { fullDeckSize } from '../../src/lib/challenge-cards'
import rawCards from '@elixir-drop/game-data/cards.json'
import { createGameRuntimeCue, transitionGameRuntimeStage } from '../../src/lib/game-runtime'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { pickLine } from '../../src/lib/elixir-lines'
import { tradeSummaryLine } from '../../src/lib/mode-insights'
import { clearTimers, elapsedWithPenalty, schedule, startCountdown } from '../../src/lib/run-loop'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, type TradeRound } from '../../src/lib/trade'
import type { Card } from '../../src/types'

function card(
  id: number,
  name: string,
  elixir: number,
  type: Card['type'] = 'troop',
  rarity: Card['rarity'] = 'common'
): Card {
  return {
    id,
    name,
    elixir,
    type,
    rarity,
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
    // The window tops out at the catalog's highest cost — offering a cost no
    // card has is a trap, not a distractor.
    expect(new Set(makeChoices(9))).toEqual(new Set([6, 7, 8, 9]))
  })

  it('maps card rarity into shared Clash-style render classes', () => {
    const hunter = card(1, 'Hunter', 4, 'troop', 'epic')

    expect(cardRarityLabel(hunter)).toBe('Epic')
    expect(cardNameToneClass(hunter)).toBe('cr-card-name--epic')
    expect(cardRarityModifier(hunter, 'cr-card-art')).toBe('cr-card-art--epic')
  })

  it('formats timed scores to the hundredth of a second', () => {
    expect(formatSeconds(28_600)).toBe('28.60')
    expect(formatSeconds(14_432)).toBe('14.43')
  })

  it('accepts a full-catalog Survival deck and rejects the wrong length', () => {
    // Survival deals every card once; the client deck length must track the
    // catalog, not a fixed number. (A stale fixed 250 broke every start.)
    const deck = (rawCards as { cards: Array<{ id: number }> }).cards.map((c) => c.id)
    expect(deck.length).toBe(fullDeckSize)
    const prepared = challengePreparers.survival({ mode: 'survival', cardIds: deck })
    expect(prepared.content).toHaveLength(fullDeckSize)
    expect(prepared.assets).toHaveLength(14)
    expect(() => challengePreparers.survival({ mode: 'survival', cardIds: deck.slice(0, fullDeckSize - 1) })).toThrow(
      /invalid signed Survival/
    )
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
    expect(insights.slowestBandLabel).toBe('6+')
    expect(insightPhrase(insights)).toContain('cost cards')
  })

  it('writes mode-specific summary coaching', () => {
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
  })

  it('interpolates Elixir lines and returns empty for unknown events', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(pickLine('correct_streak', { n: 4 })).toContain('4')
    expect(pickLine('surge_done', { time: '28.6', insight: 'clean read' })).toContain('28.6')
    expect(pickLine('missing' as never)).toBe('')
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

  it('enforces the shared game runtime lifecycle', () => {
    expect(transitionGameRuntimeStage('ready', 'countdown')).toBe('countdown')
    expect(transitionGameRuntimeStage('countdown', 'running')).toBe('running')
    expect(transitionGameRuntimeStage('running', 'summary')).toBe('summary')
    expect(transitionGameRuntimeStage('summary', 'ready')).toBe('ready')
    expect(transitionGameRuntimeStage('running', 'over')).toBe('over')
    expect(() => transitionGameRuntimeStage('ready', 'summary')).toThrow(
      'Invalid game runtime transition: ready -> summary'
    )
  })

  it('creates ordered presentation cues without putting effects in runtime state', () => {
    expect(createGameRuntimeCue(7, 'answer-correct', 1250, { cardId: 42 })).toEqual({
      id: 7,
      type: 'answer-correct',
      atMs: 1250,
      detail: { cardId: 42 }
    })
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
