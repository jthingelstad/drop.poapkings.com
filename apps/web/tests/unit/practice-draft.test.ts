import { beforeEach, describe, expect, it } from 'vitest'
import type { StartedRun } from '@elixir-drop/contracts'
import {
  beginPracticeDraft,
  clearPracticeDraft,
  loadPracticeDraft,
  PRACTICE_DRAFT_KEY,
  savePracticeDraft
} from '../../src/lib/practice-draft'

const playerId = '22222222-2222-4222-8222-222222222222'

function run(runId = 'run-practice'): StartedRun {
  return {
    runId,
    runToken: 'signed-run-token',
    mode: 'practice',
    challenge: { mode: 'practice', cardIds: [26000000, 26000001] },
    ranked: false,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  }
}

describe('Practice draft journal', () => {
  beforeEach(() => localStorage.removeItem(PRACTICE_DRAFT_KEY))

  it('restores the signed run, aggregate counters, and spaced-review state', () => {
    const draft = beginPracticeDraft(run(), playerId)
    expect(
      savePracticeDraft(draft, {
        answers: [
          {
            cardId: 26000000,
            guess: 3,
            responseMs: 812,
            assisted: false,
            correct: true,
            reviewStage: 'retry'
          }
        ],
        reviewQueue: [{ cardId: 26000001, dueAtAnswered: 4, stage: 'confirm' }],
        recovered: 1
      })
    ).toBe(true)

    expect(loadPracticeDraft(playerId)).toMatchObject({
      playerId,
      run: { runId: 'run-practice', mode: 'practice' },
      answers: [{ cardId: 26000000, correct: true, reviewStage: 'retry' }],
      reviewQueue: [{ cardId: 26000001, dueAtAnswered: 4, stage: 'confirm' }],
      recovered: 1
    })
  })

  it('does not resume another player or an expired run', () => {
    beginPracticeDraft(run(), playerId)
    expect(loadPracticeDraft('33333333-3333-4333-8333-333333333333')).toBeNull()
    expect(loadPracticeDraft(playerId, Date.now() + 25 * 60 * 60_000)).toBeNull()
  })

  it('only clears the run whose completion settled', () => {
    beginPracticeDraft(run('newer-run'), playerId)
    clearPracticeDraft('older-run')
    expect(loadPracticeDraft(playerId)?.run.runId).toBe('newer-run')
    clearPracticeDraft('newer-run')
    expect(loadPracticeDraft(playerId)).toBeNull()
  })

  it('fails closed on a transcript card outside the signed pool', () => {
    const draft = beginPracticeDraft(run(), playerId)
    savePracticeDraft(draft, {
      answers: [{ cardId: 999, guess: 3, responseMs: 500, assisted: false, correct: true }],
      reviewQueue: [],
      recovered: 0
    })
    expect(loadPracticeDraft(playerId)).toBeNull()
  })
})
