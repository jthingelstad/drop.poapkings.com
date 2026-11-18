import { exactTenHand } from '@elixir-drop/contracts/challenge-generation'
import { allCards } from '../../lib/card-catalog'
import { cardArtForDeal } from '../../lib/card-rendering'
import type { Card } from '../../types'

export function dealExactTen(): Card[] {
  return exactTenHand(allCards, (limit) => Math.floor(Math.random() * limit)).map(cardArtForDeal())
}
