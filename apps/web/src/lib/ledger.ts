import { LEDGER_MAX_PLAYS, LEDGER_MIN_PLAYS, LEDGER_VALUE_LIMIT } from '@elixir-drop/contracts'
import type { LedgerPlay, LedgerStage } from '@elixir-drop/contracts'
import type { RandomInt } from '@elixir-drop/contracts/challenge-generation'
import type { Card, CardStats, LedgerStats } from '../types'
import { browserRandomInt } from './offline-run'

export interface LedgerSequence {
  plays: Array<LedgerPlay & { card: Card }>
  balance: number
  blueTotal: number
  redTotal: number
  stage: LedgerStage
}

export const LEDGER_ANSWERS = Array.from(
  { length: LEDGER_VALUE_LIMIT * 2 + 1 },
  (_, index) => index - LEDGER_VALUE_LIMIT
)

export function ledgerStage(stats: LedgerStats): LedgerStage {
  if (stats.checks < 5) return 'guided'
  const accuracy = stats.unassistedChecks ? stats.unassistedCorrect / stats.unassistedChecks : 0
  if (stats.unassistedChecks < 12 || accuracy < 0.75) return 'faded'
  return 'tracked'
}

export function ledgerSequenceLength(stats: LedgerStats, stage = ledgerStage(stats)): number {
  if (stage === 'guided') return LEDGER_MIN_PLAYS
  if (stage === 'faded') return stats.unassistedChecks >= 6 ? 4 : 3
  return Math.min(LEDGER_MAX_PLAYS, 4 + Math.floor((stats.unassistedChecks - 12) / 10))
}

export function isFluentCard(cardId: number, stats: CardStats): boolean {
  const stat = stats[String(cardId)]
  if (!stat || stat.missStreak > 0) return false
  const seen = stat.recallSeen ?? stat.seen
  const correct = stat.recallCorrect ?? stat.correct
  return seen >= 4 && correct / seen >= 0.85 && (stat.avgMs ?? Number.POSITIVE_INFINITY) <= 3_000
}

function shuffle<T>(values: readonly T[], randomInt: RandomInt): T[] {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!]
  }
  return shuffled
}

export function dealLedgerSequence(
  deck: readonly Card[],
  stats: LedgerStats,
  previousIds: ReadonlySet<number> = new Set(),
  randomInt: RandomInt = browserRandomInt
): LedgerSequence {
  if (deck.length < LEDGER_MAX_PLAYS) throw new Error('Ledger needs at least six cards')
  const stage = ledgerStage(stats)
  const length = ledgerSequenceLength(stats, stage)
  const fresh = deck.filter((card) => !previousIds.has(card.id))
  const pool = fresh.length >= length ? fresh : deck

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const cards = shuffle(pool, randomInt).slice(0, length)
    const sides = cards.map((_, index) => {
      if (index === 0) return 'blue' as const
      if (index === 1) return 'red' as const
      return randomInt(2) === 0 ? ('blue' as const) : ('red' as const)
    })
    const plays = cards.map((card, index) => ({ card, cardId: card.id, side: sides[index]! }))
    const blueTotal = plays.reduce((sum, play) => sum + (play.side === 'blue' ? play.card.elixir : 0), 0)
    const redTotal = plays.reduce((sum, play) => sum + (play.side === 'red' ? play.card.elixir : 0), 0)
    const balance = redTotal - blueTotal
    if (Math.abs(balance) <= LEDGER_VALUE_LIMIT) return { plays, balance, blueTotal, redTotal, stage }
  }
  throw new Error('Ledger could not deal an answerable sequence')
}

export function formatLedgerBalance(value: number): string {
  if (value > 0) return `Blue +${value}`
  if (value < 0) return `Red +${Math.abs(value)}`
  return 'Even'
}
