// makeChoices(elixir) → 4 consecutive costs that CONTAIN the answer, shuffled.
// e.g. 4 → {1,2,3,4}, {2,3,4,5}, {3,4,5,6}, or {4,5,6,7}, picked at random.
// Used only by Practice's 4-choice input (PracticeLoop).
//
// The window stays adjacent on purpose — near-miss distractors are the read the
// game is teaching. What is deliberately random is where the answer sits INSIDE
// the window. A fixed window (always starting at elixir-1) made the option SET a
// giveaway: for costs 3–6, which is 94% of the catalog, exactly one answer could
// produce that set, so a player could score without ever looking at the card.

import { allCards } from './card-catalog'

const MIN = 1
// Top of the distractor window follows the catalog: offering a cost no card
// has is a trap, not a distractor.
const MAX = Math.max(...allCards.map((card) => card.elixir))
const WINDOW = 4

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function makeChoices(elixir: number): number[] {
  const answer = Math.min(Math.max(Math.round(elixir), MIN), MAX)
  // Every window start that keeps the answer inside a run of WINDOW consecutive
  // costs and the whole run inside [MIN, MAX]. Near the ends of the range the
  // choice narrows (a 1 or a 9 has only one legal window) — unavoidable, and it
  // leaks nothing a player could not already infer from the range itself.
  const lowestStart = Math.max(MIN, answer - (WINDOW - 1))
  const highestStart = Math.min(answer, MAX - WINDOW + 1)
  const offsets = Math.max(1, highestStart - lowestStart + 1)
  const start = lowestStart + Math.floor(Math.random() * offsets)

  return shuffle(Array.from({ length: WINDOW }, (_, index) => start + index))
}
