import { allCards } from '../../lib/card-catalog'
import { shuffle } from '../../lib/shuffle'
import type { Card } from '../../types'

export function dealExactTen(): Card[] {
  const pool = shuffle(allCards)
  // Keep the shortest known combination for each total. Each pass uses a
  // snapshot so the same card can never fill two slots in the solution.
  const sums = new Map<number, Card[]>([[0, []]])
  for (const card of pool) {
    for (const [sum, cards] of [...sums]) {
      const next = sum + card.elixir
      if (next > 10 || cards.length >= 5) continue
      const combination = [...cards, card]
      if (next === 10) {
        const extras = pool.filter((candidate) => !combination.includes(candidate))
        return shuffle([...combination, ...extras.slice(0, 5 - combination.length)])
      }
      if (combination.length < (sums.get(next)?.length ?? Infinity)) sums.set(next, combination)
    }
  }
  throw new Error('The card catalog has no five-card hand that can make ten.')
}
