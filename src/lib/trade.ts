import type { Card } from '../types'

export const TRADE_ANSWERS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const

export interface TradeRound {
  blue: Card[]
  red: Card[]
}

export function sideTotal(cards: Pick<Card, 'elixir'>[]): number {
  return cards.reduce((sum, card) => sum + card.elixir, 0)
}

// Player is always Blue King. Positive means the opponent spent more elixir.
export function tradeValue(round: Pick<TradeRound, 'blue' | 'red'>): number {
  return sideTotal(round.red) - sideTotal(round.blue)
}

export function formatTrade(value: number): string {
  if (value === 0) return 'Even'
  return value > 0 ? `+${value}` : String(value)
}

export function isTradeInRange(value: number): boolean {
  return value >= TRADE_ANSWERS[0] && value <= TRADE_ANSWERS[TRADE_ANSWERS.length - 1]
}

export function pickTradeHintCard(round: TradeRound, revealedIds: ReadonlySet<number>): number | undefined {
  const hidden = [...round.blue, ...round.red].filter((card) => !revealedIds.has(card.id))
  hidden.sort((a, b) => b.elixir - a.elixir || a.name.localeCompare(b.name))
  return hidden[0]?.id
}
