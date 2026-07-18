import type { Card } from '../types'
import { formatSeconds } from './format'
import { formatTrade } from './trade'

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function cardList(cards: Card[]): string {
  const names = cards.slice(0, 2).map((card) => card.name)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names[0]} and ${names[1]}`
}

export function identifySummaryLine({
  isPB,
  totalMs,
  totalCards,
  firstTry,
  misses,
  missedCards
}: {
  isPB: boolean
  totalMs: number
  totalCards: number
  firstTry: number
  misses: number
  missedCards: Card[]
}): string {
  if (isPB) return `New Identify best: ${formatSeconds(totalMs)}s. Sharp silhouette read.`
  if (misses === 0) return `${totalCards}/${totalCards} first try. The art is doing exactly what it should.`

  const missed = cardList(missedCards)
  if (missed) return `${firstTry}/${totalCards} first try. Re-drill ${missed}; the wrong taps were visual, not math.`

  return `${firstTry}/${totalCards} first try. ${pluralize(misses, 'miss', 'misses')}; slow the first glance.`
}

export function tradeSummaryLine({
  isPB,
  totalMs,
  sequenceLen,
  cleanTrades,
  wrongGuesses,
  lastTrade
}: {
  isPB: boolean
  totalMs: number
  sequenceLen: number
  cleanTrades: number
  wrongGuesses: number
  lastTrade: number
}): string {
  if (isPB) return `New Trade best: ${formatSeconds(totalMs)}s. Blue-side math is landing.`
  if (wrongGuesses === 0) return `${cleanTrades}/${sequenceLen} clean. You read both bars without a hint.`
  if (lastTrade < 0) return `${cleanTrades}/${sequenceLen} clean. Watch the sign when Blue spends more.`
  if (lastTrade > 0)
    return `${cleanTrades}/${sequenceLen} clean. Positive means Red overspent: ${formatTrade(lastTrade)} last.`
  return `${cleanTrades}/${sequenceLen} clean. Even trades are the easiest place to overthink.`
}

export function ladderSummaryLine({
  isPB,
  totalMs,
  wrongLocks
}: {
  isPB: boolean
  totalMs: number
  wrongLocks: number
}): string {
  if (isPB) return `New Ladder best: ${formatSeconds(totalMs)}s. Your low-to-high scan is getting sharp.`
  if (wrongLocks === 0) return `${formatSeconds(totalMs)}s. Clean order; now shave the hesitation between swaps.`
  return `${pluralize(wrongLocks, 'lock miss', 'lock misses')}. Use the first revealed cost as the anchor, then rebuild.`
}
