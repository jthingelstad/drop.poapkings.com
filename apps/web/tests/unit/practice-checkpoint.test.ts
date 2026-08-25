import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartedRun } from '@elixir-drop/contracts'

const api = vi.hoisted(() => ({
  getPracticeResume: vi.fn(),
  getPracticeResumeSummary: vi.fn(),
  savePracticeCheckpoint: vi.fn()
}))

vi.mock('../../src/lib/api', () => api)

import {
  restoreServerPracticeDraft,
  serverPracticeResumeAvailable,
  syncPracticeCheckpoints
} from '../../src/lib/practice-checkpoint'
import {
  beginPracticeDraft,
  clearPracticeDraft,
  loadPracticeDraft,
  savePracticeDraft
} from '../../src/lib/practice-draft'

const playerId = '22222222-2222-4222-8222-222222222222'

function run(guest = false): StartedRun {
  return {
    runId: 'practice-run',
    runToken: 'signed-run-token',
    mode: 'practice',
    challenge: { mode: 'practice', cardIds: [26000000] },
    ranked: false,
    ...(guest ? { guest: true as const } : {}),
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
}

const answer = {
  cardId: 26000000,
  guess: 3,
  responseMs: 800,
  assisted: false,
  correct: true
}

describe('Practice server checkpoints', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    serverPracticeResumeAvailable.value = false
    api.savePracticeCheckpoint.mockImplementation(async (_token, checkpoint) => ({
      accepted: true,
      runId: 'practice-run',
      answerCount: checkpoint.startIndex + checkpoint.answers.length,
      updatedAt: '2026-08-25T19:00:00.000Z'
    }))
  })

  it('uploads sequential immutable 20-answer chunks and persists the cursor', async () => {
    const draft = beginPracticeDraft(run(), playerId)
    savePracticeDraft(draft, {
      answers: Array.from({ length: 40 }, () => ({ ...answer })),
      reviewQueue: [],
      recovered: 0
    })

    await syncPracticeCheckpoints(draft, 'session-token')

    expect(api.savePracticeCheckpoint).toHaveBeenCalledTimes(2)
    expect(api.savePracticeCheckpoint.mock.calls.map((call) => call[1].startIndex)).toEqual([0, 20])
    expect(loadPracticeDraft(playerId)?.checkpointedAnswers).toBe(40)
    expect(serverPracticeResumeAvailable.value).toBe(true)
  })

  it('never uploads a guest Practice draft', async () => {
    const draft = beginPracticeDraft(run(true), null)
    savePracticeDraft(draft, {
      answers: Array.from({ length: 20 }, () => ({ ...answer })),
      reviewQueue: [],
      recovered: 0
    })

    await syncPracticeCheckpoints(draft, undefined)
    expect(api.savePracticeCheckpoint).not.toHaveBeenCalled()
  })

  it('does not resurrect a session cleared while a checkpoint is in flight', async () => {
    let acknowledge: ((value: unknown) => void) | undefined
    api.savePracticeCheckpoint.mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve
      })
    )
    const draft = beginPracticeDraft(run(), playerId)
    savePracticeDraft(draft, {
      answers: Array.from({ length: 20 }, () => ({ ...answer })),
      reviewQueue: [],
      recovered: 0
    })

    const syncing = syncPracticeCheckpoints(draft, 'session-token')
    await vi.waitFor(() => expect(api.savePracticeCheckpoint).toHaveBeenCalledTimes(1))
    clearPracticeDraft(draft.run.runId)
    acknowledge?.({
      accepted: true,
      runId: draft.run.runId,
      answerCount: 20,
      updatedAt: '2026-08-25T19:00:00.000Z'
    })
    await syncing

    expect(loadPracticeDraft(playerId)).toBeNull()
    expect(serverPracticeResumeAvailable.value).toBe(false)
  })

  it('restores the server checkpoint into the ordinary local journal', async () => {
    api.getPracticeResume.mockResolvedValue({
      draft: {
        runId: 'practice-run',
        answerCount: 20,
        updatedAt: '2026-08-25T19:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        run: run(),
        answers: Array.from({ length: 20 }, () => ({ ...answer })),
        reviewQueue: [],
        recovered: 0
      }
    })

    await expect(restoreServerPracticeDraft(playerId, 'session-token')).resolves.toBe(true)
    expect(loadPracticeDraft(playerId)).toMatchObject({
      checkpointedAnswers: 20,
      answers: expect.arrayContaining([expect.objectContaining({ cardId: 26000000 })])
    })
  })
})
