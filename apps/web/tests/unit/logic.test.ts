import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { cardNameToneClass, cardRarityLabel, cardRarityModifier } from '../../src/lib/card-rendering'
import { makeChoices } from '../../src/lib/choices'
import { formatLeaderboardSeconds, formatSeconds } from '../../src/lib/format'
import { challengePreparers } from '../../src/lib/game-challenge-content'
import { fullDeckSize } from '../../src/lib/challenge-cards'
import rawCards from '@elixir-drop/game-data/cards.json'
import { createGameRuntimeCue, transitionGameRuntimeStage } from '../../src/lib/game-runtime'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { tradeSummaryLine } from '../../src/lib/mode-insights'
import { comparableBest, pbCallout } from '../../src/lib/pb-callout'
import { cardWeight, pickPracticeCard } from '../../src/lib/practice-deal'
import { clearTimers, elapsedWithPenalty, schedule, startCountdown } from '../../src/lib/run-loop'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, type TradeRound } from '../../src/lib/trade'
import type { Card } from '../../src/types'

const CATALOG_CARDS = (rawCards as { cards: Array<{ id: number; name: string; elixir: number }> }).cards
// Every elixir cost that actually exists in the committed catalog (1..9).
const CATALOG_COSTS = [...new Set(CATALOG_CARDS.map((c) => c.elixir))].sort((a, b) => a - b)
const MAX_COST = Math.max(...CATALOG_COSTS)

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

  it('keeps Void aligned with its live five-elixir rework', () => {
    expect(CATALOG_CARDS.find((candidate) => candidate.id === 28000023)).toMatchObject({
      name: 'Void',
      elixir: 5
    })
  })

  it('keeps evolution and Hero flags aligned with their committed artwork', () => {
    const cards = (rawCards as { cards: Card[] }).cards

    for (const catalogCard of cards) {
      expect(Boolean(catalogCard.iconEvo), `${catalogCard.name} evolution artwork`).toBe(catalogCard.evo)
      expect(Boolean(catalogCard.iconHero), `${catalogCard.name} Hero artwork`).toBe(catalogCard.hero)

      for (const icon of [catalogCard.icon, catalogCard.iconEvo, catalogCard.iconHero].filter(Boolean) as string[]) {
        expect(icon, `${catalogCard.name} same-origin artwork`).toMatch(/^\/cards\/\d+(?:_(?:evo|hero))?\.png$/)
        expect(existsSync(resolve(process.cwd(), 'public', icon.slice(1))), `${catalogCard.name} ${icon}`).toBe(true)
      }
    }
  })

  it('builds a window of four adjacent costs that contains the answer', () => {
    for (const elixir of CATALOG_COSTS) {
      for (let sample = 0; sample < 200; sample += 1) {
        const choices = makeChoices(elixir)
        const sorted = [...choices].sort((a, b) => a - b)
        expect(new Set(choices).size).toBe(4)
        expect(sorted).toContain(elixir)
        // Consecutive, and never offering a cost no card in the catalog has.
        expect(sorted[3]! - sorted[0]!).toBe(3)
        expect(sorted[0]).toBeGreaterThanOrEqual(1)
        expect(sorted[3]).toBeLessThanOrEqual(MAX_COST)
      }
    }
  })

  // The distractor leak. The window is a deliberate near-miss set, but if its
  // OFFSET is fixed then the option set alone names the answer: a player could
  // read {3,4,5,6}, answer 4 without looking at the card, and be right every
  // time. This asserts the property that closes it — no option set may map to a
  // single possible answer — so it fails against any fixed-offset window.
  it('never lets the option set identify the answer', () => {
    const answersForSet = new Map<string, Set<number>>()
    for (const elixir of CATALOG_COSTS) {
      for (let sample = 0; sample < 400; sample += 1) {
        const key = [...makeChoices(elixir)].sort((a, b) => a - b).join(',')
        const answers = answersForSet.get(key) ?? new Set<number>()
        answers.add(elixir)
        answersForSet.set(key, answers)
      }
    }

    expect(answersForSet.size).toBeGreaterThan(1)
    // Any option set with a single possible answer IS the leak; listing them
    // makes a failure name the exact giveaway sets.
    const leaking = [...answersForSet.entries()]
      .filter(([, answers]) => answers.size < 2)
      .map(([optionSet, answers]) => ({ optionSet, onlyAnswer: [...answers][0] }))
    expect(leaking).toEqual([])

    // And the offset really does move: a mid-range cost is dealt from several
    // distinct windows, not one.
    const windowsForFour = new Set(
      Array.from({ length: 400 }, () => [...makeChoices(4)].sort((a, b) => a - b).join(','))
    )
    expect(windowsForFour).toEqual(new Set(['1,2,3,4', '2,3,4,5', '3,4,5,6', '4,5,6,7']))
  })

  it('maps card rarity into shared Clash-style render classes', () => {
    const hunter = card(1, 'Hunter', 4, 'troop', 'epic')

    expect(cardRarityLabel(hunter)).toBe('Epic')
    expect(cardNameToneClass(hunter)).toBe('cr-card-name--epic')
    expect(cardRarityModifier(hunter, 'cr-card-art')).toBe('cr-card-art--epic')
  })

  it('formats every timed score to the millisecond', () => {
    expect(formatSeconds(28_600)).toBe('28.600')
    expect(formatSeconds(14_432)).toBe('14.432')
  })

  it('formats leaderboard times to the millisecond', () => {
    expect(formatLeaderboardSeconds(28_600)).toBe('28.600')
    expect(formatLeaderboardSeconds(14_432)).toBe('14.432')
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
      /invalid Survival challenge/
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
    // 1 -> GO (count 0), then the GO hold before the run begins.
    vi.advanceTimersByTime(100)
    expect(count.value).toBe(0)
    vi.advanceTimersByTime(250)
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

// ── Practice's weighted deal ─────────────────────────────────────────────────
// Practice is a drill, so it must deal what the player is bad at — while still
// behaving like plain random for someone who has never played.
describe('practice deal weighting', () => {
  const stat = (over: Partial<{ seen: number; correct: number; missStreak: number }> = {}) => ({
    seen: 0,
    correct: 0,
    missStreak: 0,
    lastSeen: 0,
    ...over
  })

  it('ranks a miss streak above shaky recall, unseen, and well-known cards', () => {
    const missing = cardWeight(stat({ seen: 4, correct: 3, missStreak: 2 }))
    const shaky = cardWeight(stat({ seen: 10, correct: 5 }))
    const unseen = cardWeight(undefined)
    const known = cardWeight(stat({ seen: 10, correct: 10 }))

    expect(missing).toBeGreaterThan(shaky)
    expect(shaky).toBeGreaterThan(unseen)
    expect(unseen).toBeGreaterThan(known)
    // Rare, but never impossible: a solved card still has to be drawable.
    expect(known).toBeGreaterThan(0)
  })

  it('degrades to uniform random when a new player has no card stats', () => {
    const deck = [card(1, 'A', 3), card(2, 'B', 4), card(3, 'C', 5)]
    // Every card weighs the same, so the roll maps to thirds of the range.
    expect(pickPracticeCard(deck, {}, undefined, () => 0)).toBe(deck[0])
    expect(pickPracticeCard(deck, {}, undefined, () => 0.4)).toBe(deck[1])
    expect(pickPracticeCard(deck, {}, undefined, () => 0.9)).toBe(deck[2])
  })

  it('gives a missed card most of the range and still leaves room for the rest', () => {
    const deck = [card(1, 'A', 3), card(2, 'B', 4)]
    const stats = { '1': stat({ seen: 3, correct: 3 }), '2': stat({ seen: 3, correct: 2, missStreak: 1 }) }
    // Weights: known 1, missing 12 → the missed card owns 12/13 of the range.
    expect(pickPracticeCard(deck, stats, undefined, () => 0)).toBe(deck[0])
    expect(pickPracticeCard(deck, stats, undefined, () => 0.5)).toBe(deck[1])
    expect(pickPracticeCard(deck, stats, undefined, () => 0.99)).toBe(deck[1])
  })

  it('never deals the same card twice in a row', () => {
    const deck = [card(1, 'A', 3), card(2, 'B', 4)]
    const stats = { '2': stat({ seen: 2, correct: 0, missStreak: 2 }) }
    // Card 2 is the heaviest by far, but it was just played.
    expect(pickPracticeCard(deck, stats, 2, () => 0.99)).toBe(deck[0])
    // A one-card deck has nothing else to deal, so the guard must not strand it.
    expect(pickPracticeCard([deck[0]!], {}, 1, () => 0.5)).toBe(deck[0])
    expect(pickPracticeCard([], {}, undefined, () => 0)).toBeUndefined()
  })
})

// ── Summary personal-best callout ────────────────────────────────────────────
// One three-state chain shared by every mode; each mode supplies only the words.
describe('pbCallout', () => {
  const copy = {
    first: 'First Surge logged',
    improved: (previous: number) => `New best! −${previous - 900}ms`,
    standing: (previous: number) => `Best: ${previous}`
  }

  it('names the first-ever run rather than comparing against nothing', () => {
    expect(pbCallout(true, undefined, copy)).toBe('First Surge logged')
  })

  it('reports the improvement against the mark that was actually beaten', () => {
    expect(pbCallout(true, 1_200, copy)).toBe('New best! −300ms')
  })

  it('shows the standing best when the run fell short', () => {
    expect(pbCallout(false, 1_200, copy)).toBe('Best: 1200')
  })

  it('says nothing at all when a non-PB run has no best to report', () => {
    expect(pbCallout(false, undefined, copy)).toBeUndefined()
  })

  it('treats a recorded 0 in a count mode as no best worth beating', () => {
    expect(comparableBest(0)).toBeUndefined()
    expect(comparableBest(undefined)).toBeUndefined()
    expect(comparableBest(7)).toBe(7)
  })
})
