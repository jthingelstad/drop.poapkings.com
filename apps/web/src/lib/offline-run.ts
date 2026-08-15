import type { GameMode, StartedRun } from '@elixir-drop/contracts'
import { createChallenge, type RandomInt } from '@elixir-drop/contracts/challenge-generation'
import { allCards } from './card-catalog'

// Local runs are a gameplay path, never a delayed write. The prefix is the
// hard boundary checked before completion: no token, transcript, score, or
// reconnection can turn one into a server run later.
const OFFLINE_RUN_PREFIX = 'offline:'
const OFFLINE_RUN_MS = 24 * 60 * 60 * 1_000
const UINT32_RANGE = 0x1_0000_0000

export const browserRandomInt: RandomInt = (upperBound) => {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0 || upperBound > UINT32_RANGE) {
    throw new RangeError('Random upper bound must be a positive 32-bit integer')
  }
  // Rejection sampling avoids modulo bias while keeping the shared challenge
  // generator independent of its browser/server entropy source.
  const limit = Math.floor(UINT32_RANGE / upperBound) * upperBound
  const sample = new Uint32Array(1)
  do globalThis.crypto.getRandomValues(sample)
  while (sample[0]! >= limit)
  return sample[0]! % upperBound
}

export function isOfflineRun(run: { runId?: string } | null | undefined): boolean {
  return Boolean(run?.runId?.startsWith(OFFLINE_RUN_PREFIX))
}

export function localOfflineRun(mode: GameMode, now = Date.now(), randomInt = browserRandomInt): StartedRun {
  return {
    runId: `${OFFLINE_RUN_PREFIX}${mode}:${now}`,
    // The empty token is intentional: offline runs are settled in the browser
    // and can never authorize /runs/complete.
    runToken: '',
    mode,
    challenge: createChallenge(mode, randomInt, allCards),
    expiresAt: new Date(now + OFFLINE_RUN_MS).toISOString()
  }
}
