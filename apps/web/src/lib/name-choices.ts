import type { Card } from '../types'

export const NAME_CHOICE_COUNT = 6

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function distractorScore(target: Card, candidate: Card): number {
  let score = Math.abs(candidate.elixir - target.elixir) * 3
  if (candidate.type !== target.type) score += 4
  if (candidate.rarity !== target.rarity) score += 1
  if (candidate.evo !== target.evo) score += 1
  if (candidate.hero !== target.hero) score += 1
  return score
}

export function makeNameChoices(target: Card, cards: Card[], count = NAME_CHOICE_COUNT): Card[] {
  const distractors = shuffle(cards.filter((card) => card.id !== target.id))
    .sort((a, b) => distractorScore(target, a) - distractorScore(target, b))
    .slice(0, Math.max(0, count - 1))

  return shuffle([target, ...distractors])
}
