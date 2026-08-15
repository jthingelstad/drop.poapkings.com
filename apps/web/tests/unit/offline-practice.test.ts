import { describe, expect, it } from 'vitest'
import { isOfflineRun, localPracticeRun } from '../../src/lib/offline-practice'
import { allCards } from '../../src/lib/card-catalog'

describe('offline Practice', () => {
  it('deals the whole catalog as a pool, matching the server', () => {
    const run = localPracticeRun()
    expect(run.mode).toBe('practice')
    const challenge = run.challenge as { mode: 'practice'; cardIds: number[] }
    // The API's Practice deal is shuffle(pool) over the whole catalog, so the
    // offline deal is the same set — not a narrower or easier one.
    const byId = (left: number, right: number) => left - right
    expect([...challenge.cardIds].sort(byId)).toEqual([...allCards.map((card) => card.id)].sort(byId))
  })

  it('shuffles, so two sessions are not the same order', () => {
    const ids = () => (localPracticeRun().challenge as { cardIds: number[] }).cardIds.join(',')
    expect(ids()).not.toBe(ids())
  })

  it('carries no run token, so it can never be completed against the server', () => {
    expect(localPracticeRun().runToken).toBe('')
  })

  it('is recognisable as offline, and a server run never is', () => {
    expect(isOfflineRun(localPracticeRun())).toBe(true)
    expect(isOfflineRun({ runId: 'b3f7c1d2-9a4e-4c11-8f2a-5d6e7f801234' })).toBe(false)
    expect(isOfflineRun(null)).toBe(false)
    expect(isOfflineRun(undefined)).toBe(false)
  })

  it('does not expire mid-session', () => {
    const now = Date.now()
    expect(Date.parse(localPracticeRun(now).expiresAt)).toBeGreaterThan(now + 60 * 60 * 1_000)
  })
})
