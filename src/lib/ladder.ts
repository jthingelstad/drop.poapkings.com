import type { Card } from '../types'

export function isAscendingByElixir(cards: Pick<Card, 'elixir'>[]): boolean {
  for (let i = 1; i < cards.length; i += 1) {
    if (cards[i - 1].elixir > cards[i].elixir) return false
  }
  return true
}

export function reorderCards<T>(cards: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return cards
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= cards.length || toIndex >= cards.length) return cards

  const next = [...cards]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
