import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeChoices } from '../../src/lib/choices'
import { formatSeconds } from '../../src/lib/format'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { pickLine } from '../../src/lib/elixir-lines'
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

  it('interpolates Elixir lines and returns empty for unknown events', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(pickLine('correct_streak', { n: 4 })).toContain('4')
    expect(pickLine('surge_done', { time: '28.6', insight: 'clean read' })).toContain('28.6')
    expect(pickLine('missing' as never)).toBe('')
  })
})
