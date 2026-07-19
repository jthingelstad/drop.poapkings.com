// makeChoices(elixir) → 4 adjacent costs, shuffled.
// e.g. 4 → [3,4,5,6]; 1 → [1,2,3,4]; 9 → [7,8,9,10]
// Shared by every multiple-choice surface.

import rawCards from '@elixir-drop/game-data/cards.json'
import type { CardsData } from '../types'

const MIN = 1
// Top of the distractor window follows the catalog: offering a cost no card
// has is a trap, not a distractor.
const MAX = Math.max(...(rawCards as CardsData).cards.map((card) => card.elixir))

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function makeChoices(elixir: number): number[] {
  // Window of 4 starting at elixir-1, clamped so the whole window fits [MIN, MAX]
  let start = Math.max(MIN, elixir - 1)
  if (start + 3 > MAX) start = MAX - 3

  const choices: number[] = []
  for (let i = start; i <= start + 3; i++) choices.push(i)

  return shuffle(choices)
}
