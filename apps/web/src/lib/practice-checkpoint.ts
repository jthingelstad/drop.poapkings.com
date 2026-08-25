import { signal } from '@preact/signals'
import { getPracticeResume, getPracticeResumeSummary, savePracticeCheckpoint } from './api'
import { offline } from './api-availability'
import {
  PRACTICE_DRAFT_CHUNK_SIZE,
  isPracticeDraftActive,
  restorePracticeDraft,
  savePracticeDraft,
  type PracticeDraft
} from './practice-draft'
import { isOfflineRun } from './offline-run'

export const serverPracticeResumeAvailable = signal(false)
export const practiceCheckpointHealth = signal<
  { state: 'idle' } | { state: 'saved'; answerCount: number; updatedAt: string } | { state: 'error'; failedAt: string }
>({ state: 'idle' })

const inFlight = new Map<string, Promise<void>>()

export function clearPracticeResumeAvailability(): void {
  serverPracticeResumeAvailable.value = false
  practiceCheckpointHealth.value = { state: 'idle' }
}

export async function refreshPracticeResumeAvailability(sessionToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await getPracticeResumeSummary(sessionToken, signal)
  const available = response.draft !== null && response.draft.answerCount > 0
  serverPracticeResumeAvailable.value = available
  return available
}

export async function restoreServerPracticeDraft(playerId: string, sessionToken: string): Promise<boolean> {
  const response = await getPracticeResume(sessionToken)
  const recovered = response.draft
  if (!recovered) {
    serverPracticeResumeAvailable.value = false
    return false
  }
  if (recovered.answerCount !== recovered.answers.length)
    throw new Error('Practice recovery answer count did not match.')
  const draft = restorePracticeDraft(playerId, {
    run: recovered.run,
    answers: recovered.answers,
    reviewQueue: recovered.reviewQueue,
    recovered: recovered.recovered,
    checkpointedAnswers: recovered.answers.length,
    updatedAt: recovered.updatedAt
  })
  if (!draft) throw new Error('Practice recovery could not be saved on this device.')
  serverPracticeResumeAvailable.value = true
  practiceCheckpointHealth.value = {
    state: 'saved',
    answerCount: recovered.answers.length,
    updatedAt: recovered.updatedAt
  }
  return true
}

async function sync(draft: PracticeDraft, sessionToken: string): Promise<void> {
  while (draft.answers.length - draft.checkpointedAnswers >= PRACTICE_DRAFT_CHUNK_SIZE) {
    const startIndex = draft.checkpointedAnswers
    const result = await savePracticeCheckpoint(sessionToken, {
      runToken: draft.run.runToken,
      startIndex,
      answers: draft.answers.slice(startIndex, startIndex + PRACTICE_DRAFT_CHUNK_SIZE),
      reviewQueue: draft.reviewQueue,
      recovered: Math.min(draft.recovered, startIndex + PRACTICE_DRAFT_CHUNK_SIZE)
    })
    draft.checkpointedAnswers = result.answerCount
    // Completion may have cleared this journal while the request was in
    // flight. Never let a late acknowledgement resurrect a settled session.
    if (!isPracticeDraftActive(draft.run.runId)) return
    savePracticeDraft(draft, {
      answers: draft.answers,
      reviewQueue: draft.reviewQueue,
      recovered: draft.recovered,
      checkpointedAnswers: result.answerCount
    })
    serverPracticeResumeAvailable.value = true
    practiceCheckpointHealth.value = {
      state: 'saved',
      answerCount: result.answerCount,
      updatedAt: result.updatedAt
    }
  }
}

export function syncPracticeCheckpoints(draft: PracticeDraft, sessionToken: string | undefined): Promise<void> {
  if (!sessionToken || offline.peek() || draft.run.guest || isOfflineRun(draft.run)) return Promise.resolve()
  const running = inFlight.get(draft.run.runId)
  if (running) return running
  const request = sync(draft, sessionToken)
    .catch((error: unknown) => {
      practiceCheckpointHealth.value = { state: 'error', failedAt: new Date().toISOString() }
      console.warn('Practice checkpoint could not be saved', {
        runId: draft.run.runId,
        error: error instanceof Error ? error.name : 'unknown'
      })
    })
    .finally(() => {
      inFlight.delete(draft.run.runId)
    })
  inFlight.set(draft.run.runId, request)
  return request
}
