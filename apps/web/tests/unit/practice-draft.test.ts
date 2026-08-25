import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartedRun } from '@elixir-drop/contracts'
import {
  beginPracticeDraft,
  clearPracticeDraft,
  LEGACY_PRACTICE_DRAFT_KEY,
  loadPracticeDraft,
  PRACTICE_DRAFT_KEY,
  practiceDraftHealth,
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
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

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

  it('migrates an in-flight v1 draft without losing an answer', () => {
    localStorage.setItem(
      LEGACY_PRACTICE_DRAFT_KEY,
      JSON.stringify({
        version: 1,
        playerId,
        run: run(),
        answers: [{ cardId: 26000000, guess: 3, responseMs: 812, assisted: false, correct: true }],
        reviewQueue: [],
        recovered: 0,
        updatedAt: new Date().toISOString()
      })
    )

    expect(loadPracticeDraft(playerId)?.answers).toHaveLength(1)
    expect(localStorage.getItem(LEGACY_PRACTICE_DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(PRACTICE_DRAFT_KEY)).not.toBeNull()
  })

  it('keeps a 2,600-answer run in small append-only chunks', () => {
    const writes: number[] = []
    const original = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      writes.push(value.length)
      original(key, value)
    })
    const draft = beginPracticeDraft(run(), playerId)
    const answers: Array<{
      cardId: number
      guess: number
      responseMs: number
      assisted: boolean
      correct: boolean
    }> = []
    for (let index = 0; index < 2_600; index += 1) {
      answers.push({
        cardId: index % 2 === 0 ? 26000000 : 26000001,
        guess: 3,
        responseMs: 800,
        assisted: false,
        correct: true
      })
      expect(savePracticeDraft(draft, { answers, reviewQueue: [], recovered: 0 })).toBe(true)
    }

    expect(loadPracticeDraft(playerId)?.answers).toHaveLength(2_600)
    expect(Math.max(...writes)).toBeLessThan(10_000)
    expect(writes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThan(10_000_000)
  })

  it('surfaces browser storage failure instead of silently claiming durability', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    beginPracticeDraft(run(), playerId)
    expect(practiceDraftHealth.value).toMatchObject({ state: 'error', answerCount: 0 })
  })
})
