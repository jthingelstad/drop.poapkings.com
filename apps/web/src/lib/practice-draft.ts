import type { StartedRun } from '@elixir-drop/contracts'
import type { PracticeReviewItem, PracticeReviewStage } from './practice-review'

export const PRACTICE_DRAFT_KEY = 'elixirdrop:practiceDraft:v1'
const MAX_ANSWERS = 10_000

export interface PracticeDraftAnswer {
  cardId: number
  guess: number
  responseMs: number
  assisted: boolean
  correct: boolean
  reviewStage?: PracticeReviewStage
}

export interface PracticeDraft {
  version: 1
  playerId: string | null
  run: StartedRun
  answers: PracticeDraftAnswer[]
  reviewQueue: PracticeReviewItem[]
  recovered: number
  updatedAt: string
}

function write(draft: PracticeDraft): boolean {
  try {
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function validReviewStage(value: unknown): value is PracticeReviewStage {
  return value === 'retry' || value === 'confirm'
}

function parseAnswer(value: unknown, deck: Set<number>): PracticeDraftAnswer | undefined {
  const answer = object(value)
  if (!answer) return undefined
  const cardId = Number(answer.cardId)
  const guess = Number(answer.guess)
  const responseMs = Number(answer.responseMs)
  if (
    !Number.isInteger(cardId) ||
    !deck.has(cardId) ||
    !Number.isInteger(guess) ||
    !Number.isInteger(responseMs) ||
    responseMs < 0 ||
    responseMs > 60_000 ||
    typeof answer.assisted !== 'boolean' ||
    typeof answer.correct !== 'boolean' ||
    (answer.reviewStage !== undefined && !validReviewStage(answer.reviewStage))
  )
    return undefined
  return {
    cardId,
    guess,
    responseMs,
    assisted: answer.assisted,
    correct: answer.correct,
    ...(answer.reviewStage ? { reviewStage: answer.reviewStage } : {})
  }
}

function parseReview(value: unknown, deck: Set<number>): PracticeReviewItem | undefined {
  const review = object(value)
  if (!review) return undefined
  const cardId = Number(review.cardId)
  const dueAtAnswered = Number(review.dueAtAnswered)
  if (!deck.has(cardId) || !Number.isSafeInteger(dueAtAnswered) || dueAtAnswered < 0 || !validReviewStage(review.stage))
    return undefined
  return { cardId, dueAtAnswered, stage: review.stage }
}

export function loadPracticeDraft(playerId: string | null, now = Date.now()): PracticeDraft | null {
  try {
    const value = object(JSON.parse(localStorage.getItem(PRACTICE_DRAFT_KEY) || 'null'))
    const run = object(value?.run)
    const challenge = object(run?.challenge)
    const expiresAt = typeof run?.expiresAt === 'string' ? Date.parse(run.expiresAt) : Number.NaN
    if (
      value?.version !== 1 ||
      value.playerId !== playerId ||
      !run ||
      typeof run.runId !== 'string' ||
      typeof run.runToken !== 'string' ||
      run.mode !== 'practice' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      challenge?.mode !== 'practice' ||
      !Array.isArray(challenge.cardIds)
    )
      return null
    const deck = new Set(challenge.cardIds.map(Number).filter(Number.isInteger))
    if (!deck.size || !Array.isArray(value.answers) || value.answers.length > MAX_ANSWERS) return null
    const answers = value.answers.map((answer) => parseAnswer(answer, deck))
    if (answers.some((answer) => answer === undefined)) return null
    if (!Array.isArray(value.reviewQueue)) return null
    const reviewQueue = value.reviewQueue.map((review) => parseReview(review, deck))
    if (reviewQueue.some((review) => review === undefined)) return null
    if (!Number.isSafeInteger(value.recovered) || Number(value.recovered) < 0 || typeof value.updatedAt !== 'string')
      return null
    return {
      version: 1,
      playerId,
      run: run as unknown as StartedRun,
      answers: answers as PracticeDraftAnswer[],
      reviewQueue: reviewQueue as PracticeReviewItem[],
      recovered: Number(value.recovered),
      updatedAt: value.updatedAt
    }
  } catch {
    return null
  }
}

export function beginPracticeDraft(run: StartedRun, playerId: string | null): PracticeDraft {
  const draft: PracticeDraft = {
    version: 1,
    playerId,
    run,
    answers: [],
    reviewQueue: [],
    recovered: 0,
    updatedAt: new Date().toISOString()
  }
  write(draft)
  return draft
}

export function savePracticeDraft(
  draft: PracticeDraft,
  progress: Pick<PracticeDraft, 'answers' | 'reviewQueue' | 'recovered'>
): boolean {
  draft.answers = progress.answers
  draft.reviewQueue = progress.reviewQueue
  draft.recovered = progress.recovered
  draft.updatedAt = new Date().toISOString()
  return write(draft)
}

export function clearPracticeDraft(runId?: string): void {
  try {
    if (runId) {
      const stored = object(JSON.parse(localStorage.getItem(PRACTICE_DRAFT_KEY) || 'null'))
      const run = object(stored?.run)
      if (run?.runId !== runId) return
    }
    localStorage.removeItem(PRACTICE_DRAFT_KEY)
  } catch {
    // A corrupt or unavailable store cannot hold a resumable draft.
  }
}
