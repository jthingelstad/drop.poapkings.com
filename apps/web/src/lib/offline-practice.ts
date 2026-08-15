import type { StartedRun } from '@elixir-drop/contracts'
import { allCards } from './card-catalog'

// Practice is the one mode that can run with no server at all, and it is not a
// loophole — it is what Practice already is. It is unranked and unscored, earns
// no XP, keeps no record, and skips the leaderboard entirely. The signed
// challenge exists to protect rankings; Practice has none to protect.
//
// It is also the only mode whose server deal can be reproduced exactly. The
// API's Practice challenge is `shuffle(pool)` over the whole catalog — a POOL,
// not a sequence (services/api/src/scoring.ts). So this is a shuffle, not a
// reintroduction of the client-side sampler that was deliberately deleted: the
// weakness weighting that decides what a player actually sees has always lived
// in the browser, in lib/practice-deal.ts.
//
// An offline session records NOTHING: no history row, no server learning stats,
// no badges, no XP, no streak. Local cardStats still update, so the drill keeps
// getting sharper on this device.
const OFFLINE_RUN_PREFIX = 'offline-practice:'

// Long enough that a session on a plane never expires mid-drill. Nothing is
// recorded, so the value is a formality the run shape requires.
const OFFLINE_RUN_MS = 24 * 60 * 60 * 1_000

export function isOfflineRun(run: { runId?: string } | null | undefined): boolean {
  return Boolean(run?.runId?.startsWith(OFFLINE_RUN_PREFIX))
}

export function localPracticeRun(now = Date.now(), random = Math.random): StartedRun {
  const cardIds = allCards.map((card) => card.id)
  // Fisher-Yates, matching the server's shuffle of the same catalog.
  for (let index = cardIds.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const held = cardIds[index]!
    cardIds[index] = cardIds[swap]!
    cardIds[swap] = held
  }
  return {
    runId: `${OFFLINE_RUN_PREFIX}${now}`,
    // No token: there is no completion to authorize. A recorded run can never
    // be forged from this because the server never issued it.
    runToken: '',
    mode: 'practice',
    challenge: { mode: 'practice', cardIds },
    expiresAt: new Date(now + OFFLINE_RUN_MS).toISOString()
  }
}
