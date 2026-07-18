import rawCards from '@elixir-drop/game-data/cards.json'
import type { Card, CardsData } from '../types'

const cards = (rawCards as CardsData).cards
const byId = new Map(cards.map((card) => [card.id, card]))

export function challengeCards(ids: readonly number[]): Card[] {
  const resolved = ids.map((id) => byId.get(id))
  return resolved.every((card): card is Card => Boolean(card)) ? resolved : []
}

export function challengeCard(id: number): Card | undefined {
  return byId.get(id)
}
