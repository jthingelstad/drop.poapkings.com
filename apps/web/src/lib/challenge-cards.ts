import rawCards from '@elixir-drop/game-data/cards.json'
import type { Card, CardsData } from '../types'

const cards = (rawCards as CardsData).cards
const byId = new Map(cards.map((card) => [card.id, card]))

// Survival deals the entire catalog once (clearing it is a win), so its signed
// deck length tracks the card count rather than a fixed number.
export const fullDeckSize = cards.length

export function challengeCards(ids: readonly number[]): Card[] {
  const resolved = ids.map((id) => byId.get(id))
  return resolved.every((card): card is Card => Boolean(card)) ? resolved : []
}

export function challengeCard(id: number): Card | undefined {
  return byId.get(id)
}
