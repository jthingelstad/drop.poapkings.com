import type { Card } from '../types'
import { getCardStats } from './storage'

// SRS-lite weighted sampling. Tunables in one place.
const CFG = {
  BASE: 10,
  MISS_WEIGHT: 4, // per consecutive miss
  MASTERY_DECAY: 2, // per correct answer (dampened by MASTERY_CAP)
  MASTERY_CAP: 5, // max correct answers that reduce weight
  RECENCY_PENALTY: 10, // card shown very recently
  RECENCY_DECAY: 2, // drops by this per card seen since
  RECENCY_WINDOW: 6, // cards back to consider
  MIN_WEIGHT: 1 // floor — mastered cards still resurface
}

function cardWeight(id: number, lastSeen: number[]): number {
  const stats = getCardStats()
  const s = stats[String(id)]

  let w = CFG.BASE

  if (s) {
    w += s.missStreak * CFG.MISS_WEIGHT
    w -= Math.min(s.correct, CFG.MASTERY_CAP) * CFG.MASTERY_DECAY
  }

  // Recency penalty: avoid repeating a card that just appeared
  const recentIdx = lastSeen.lastIndexOf(id)
  if (recentIdx >= 0) {
    const cardsAgo = lastSeen.length - recentIdx
    w += Math.max(0, CFG.RECENCY_PENALTY - cardsAgo * CFG.RECENCY_DECAY)
  }

  return Math.max(CFG.MIN_WEIGHT, w)
}

export function sampleCard(cards: Card[], lastSeen: number[]): Card {
  const weights = cards.map((c) => cardWeight(c.id, lastSeen))
  const total = weights.reduce((a, b) => a + b, 0)

  let r = Math.random() * total
  for (let i = 0; i < cards.length; i++) {
    r -= weights[i]
    if (r <= 0) return cards[i]
  }
  return cards[cards.length - 1]
}
