// Practice's weighted deal. Practice is endless and non-competitive, so it can
// afford to be a real drill: it deals the cards the player keeps getting wrong
// far more often than the ones they have already proven they know.
//
// The signal is the same local `elixirdrop:cardStats` every recall mode already
// writes through lib/storage.ts. The deal stays device-local and affects no
// score; online completions independently derive server-owned learning stats
// from their validated transcripts.

import type { Card, CardStat, CardStats } from '../types'

// Relative draw weights, heaviest first. A brand-new player has no stats at all,
// so every card scores UNSEEN and the deal degrades to uniform random — the
// fallback is the default, not a special case.
const WEIGHT_MISSING = 12 // currently on a miss streak — the whole point of the drill
const WEIGHT_SHAKY = 6 // seen enough to have a record, and the record is poor
const WEIGHT_UNSEEN = 3 // never practiced on this device
const WEIGHT_LEARNING = 2 // getting there: right more often than not, not yet proven
const WEIGHT_KNOWN = 1 // rare, but never impossible — a drill that drops solved cards stops being the real deck

const SHAKY_ACCURACY = 0.7
const KNOWN_ACCURACY = 0.9
const KNOWN_REPS = 4
export const SLOW_RECALL_MS = 3_000

export function cardWeight(stat: CardStat | undefined): number {
  if (!stat || stat.seen <= 0) return WEIGHT_UNSEEN
  if (stat.missStreak > 0) return WEIGHT_MISSING
  const recallSeen = stat.recallSeen ?? stat.seen
  const recallCorrect = stat.recallCorrect ?? stat.correct
  // Recognition practice is useful, but without an unassisted read there is no
  // evidence yet that the player can produce the value from memory.
  if (recallSeen <= 0) return WEIGHT_LEARNING
  const accuracy = recallCorrect / recallSeen
  if (accuracy < SHAKY_ACCURACY) return WEIGHT_SHAKY
  if (stat.avgMs !== undefined && stat.avgMs >= SLOW_RECALL_MS) return WEIGHT_SHAKY
  if (recallSeen >= KNOWN_REPS && accuracy >= KNOWN_ACCURACY) return WEIGHT_KNOWN
  return WEIGHT_LEARNING
}

// Draw the next card from the signed deck. `previousId` is excluded so the same
// card never lands twice in a row (a heavy weight would otherwise make a
// stubborn card repeat immediately, which reads as a bug rather than a drill).
// `random` is injectable so the weighting is unit-testable without sampling.
export function pickPracticeCard(
  deck: readonly Card[],
  stats: CardStats,
  previousId?: number,
  random: () => number = Math.random
): Card | undefined {
  if (deck.length === 0) return undefined
  const pool = deck.length > 1 ? deck.filter((card) => card.id !== previousId) : deck
  if (pool.length === 0) return undefined

  let total = 0
  const cumulative = pool.map((card) => {
    total += cardWeight(stats[String(card.id)])
    return total
  })
  const roll = random() * total
  const index = cumulative.findIndex((edge) => roll < edge)
  return pool[index === -1 ? pool.length - 1 : index]
}
