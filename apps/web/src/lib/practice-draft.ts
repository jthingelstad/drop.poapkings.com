import { signal } from '@preact/signals'
import type { StartedRun } from '@elixir-drop/contracts'
import type { PracticeReviewItem, PracticeReviewStage } from './practice-review'

export const PRACTICE_DRAFT_KEY = 'elixirdrop:practiceDraft:v2'
export const LEGACY_PRACTICE_DRAFT_KEY = 'elixirdrop:practiceDraft:v1'
export const PRACTICE_DRAFT_CHUNK_SIZE = 20
const CHUNK_PREFIX = `${PRACTICE_DRAFT_KEY}:chunk:`
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
  version: 2
  playerId: string | null
  run: StartedRun
  answers: PracticeDraftAnswer[]
  reviewQueue: PracticeReviewItem[]
  recovered: number
  checkpointedAnswers: number
  updatedAt: string
}

interface StoredPracticeDraft {
  version: 2
  playerId: string | null
  run: StartedRun
  answerCount: number
  chunkCount: number
  tail: PracticeDraftAnswer[]
  reviewQueue: PracticeReviewItem[]
  recovered: number
  checkpointedAnswers: number
  updatedAt: string
  lastSavedBytes: number
}

export type PracticeDraftHealth =
  | { state: 'idle' }
  | { state: 'saved'; answerCount: number; updatedAt: string; lastSavedBytes: number }
  | { state: 'error'; answerCount: number; failedAt: string }

export const practiceDraftHealth = signal<PracticeDraftHealth>({ state: 'idle' })

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function chunkKey(runId: string, index: number): string {
  return `${CHUNK_PREFIX}${runId}:${String(index).padStart(4, '0')}`
}

function storedMeta(): StoredPracticeDraft | undefined {
  try {
    return object(JSON.parse(localStorage.getItem(PRACTICE_DRAFT_KEY) || 'null')) as unknown as
      StoredPracticeDraft | undefined
  } catch {
    return undefined
  }
}

function write(draft: PracticeDraft): boolean {
  const completedChunkCount = Math.floor(draft.answers.length / PRACTICE_DRAFT_CHUNK_SIZE)
  const previous = storedMeta()
  const previousChunkCount = previous?.run?.runId === draft.run.runId ? previous.chunkCount : 0
  let writtenBytes = 0
  try {
    for (let index = previousChunkCount; index < completedChunkCount; index += 1) {
      const value = JSON.stringify(
        draft.answers.slice(index * PRACTICE_DRAFT_CHUNK_SIZE, (index + 1) * PRACTICE_DRAFT_CHUNK_SIZE)
      )
      localStorage.setItem(chunkKey(draft.run.runId, index), value)
      writtenBytes += value.length
    }
    const tail = draft.answers.slice(completedChunkCount * PRACTICE_DRAFT_CHUNK_SIZE)
    const base = {
      version: 2 as const,
      playerId: draft.playerId,
      run: draft.run,
      answerCount: draft.answers.length,
      chunkCount: completedChunkCount,
      tail,
      reviewQueue: draft.reviewQueue,
      recovered: draft.recovered,
      checkpointedAnswers: draft.checkpointedAnswers,
      updatedAt: draft.updatedAt
    }
    const initial = JSON.stringify({ ...base, lastSavedBytes: 0 })
    const stored: StoredPracticeDraft = { ...base, lastSavedBytes: writtenBytes + initial.length }
    const value = JSON.stringify(stored)
    localStorage.setItem(PRACTICE_DRAFT_KEY, value)
    practiceDraftHealth.value = {
      state: 'saved',
      answerCount: draft.answers.length,
      updatedAt: draft.updatedAt,
      lastSavedBytes: writtenBytes + value.length
    }
    return true
  } catch {
    practiceDraftHealth.value = {
      state: 'error',
      answerCount: draft.answers.length,
      failedAt: new Date().toISOString()
    }
    return false
  }
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

function validRun(value: Record<string, unknown> | undefined, playerId: string | null, now: number) {
  const run = object(value?.run)
  const challenge = object(run?.challenge)
  const expiresAt = typeof run?.expiresAt === 'string' ? Date.parse(run.expiresAt) : Number.NaN
  if (
    value?.playerId !== playerId ||
    !run ||
    typeof run.runId !== 'string' ||
    typeof run.runToken !== 'string' ||
    run.mode !== 'practice' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    challenge?.mode !== 'practice' ||
    !Array.isArray(challenge.cardIds)
  )
    return undefined
  const deck = new Set(challenge.cardIds.map(Number).filter(Number.isInteger))
  if (!deck.size) return undefined
  return { run: run as unknown as StartedRun, deck }
}

function parseProgress(
  value: Record<string, unknown>,
  run: StartedRun,
  deck: Set<number>,
  answers: unknown[]
): PracticeDraft | null {
  if (answers.length > MAX_ANSWERS) return null
  const parsedAnswers = answers.map((answer) => parseAnswer(answer, deck))
  if (parsedAnswers.some((answer) => answer === undefined) || !Array.isArray(value.reviewQueue)) return null
  const reviewQueue = value.reviewQueue.map((review) => parseReview(review, deck))
  if (reviewQueue.some((review) => review === undefined)) return null
  const checkpointedAnswers = Number(value.checkpointedAnswers ?? 0)
  if (
    !Number.isSafeInteger(value.recovered) ||
    Number(value.recovered) < 0 ||
    typeof value.updatedAt !== 'string' ||
    !Number.isSafeInteger(checkpointedAnswers) ||
    checkpointedAnswers < 0 ||
    checkpointedAnswers > answers.length ||
    checkpointedAnswers % PRACTICE_DRAFT_CHUNK_SIZE !== 0
  )
    return null
  return {
    version: 2,
    playerId: value.playerId as string | null,
    run,
    answers: parsedAnswers as PracticeDraftAnswer[],
    reviewQueue: reviewQueue as PracticeReviewItem[],
    recovered: Number(value.recovered),
    checkpointedAnswers,
    updatedAt: value.updatedAt
  }
}

function loadCurrent(playerId: string | null, now: number): PracticeDraft | null {
  const value = object(JSON.parse(localStorage.getItem(PRACTICE_DRAFT_KEY) || 'null'))
  const valid = validRun(value, playerId, now)
  if (!valid || value?.version !== 2) return null
  const answerCount = Number(value.answerCount)
  const chunkCount = Number(value.chunkCount)
  if (
    !Number.isSafeInteger(answerCount) ||
    answerCount < 0 ||
    answerCount > MAX_ANSWERS ||
    !Number.isSafeInteger(chunkCount) ||
    chunkCount < 0 ||
    chunkCount !== Math.floor(answerCount / PRACTICE_DRAFT_CHUNK_SIZE) ||
    !Array.isArray(value.tail) ||
    value.tail.length !== answerCount % PRACTICE_DRAFT_CHUNK_SIZE
  )
    return null
  const answers: unknown[] = []
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = JSON.parse(localStorage.getItem(chunkKey(valid.run.runId, index)) || 'null')
    if (!Array.isArray(chunk) || chunk.length !== PRACTICE_DRAFT_CHUNK_SIZE) return null
    answers.push(...chunk)
  }
  answers.push(...value.tail)
  const draft = parseProgress(value, valid.run, valid.deck, answers)
  if (draft && practiceDraftHealth.peek().state !== 'error') {
    practiceDraftHealth.value = {
      state: 'saved',
      answerCount: draft.answers.length,
      updatedAt: draft.updatedAt,
      lastSavedBytes: Number(value.lastSavedBytes) || 0
    }
  }
  return draft
}

function loadLegacy(playerId: string | null, now: number): PracticeDraft | null {
  const value = object(JSON.parse(localStorage.getItem(LEGACY_PRACTICE_DRAFT_KEY) || 'null'))
  const valid = validRun(value, playerId, now)
  if (!valid || value?.version !== 1 || !Array.isArray(value.answers)) return null
  return parseProgress({ ...value, checkpointedAnswers: 0 }, valid.run, valid.deck, value.answers)
}

export function loadPracticeDraft(playerId: string | null, now = Date.now()): PracticeDraft | null {
  try {
    const current = loadCurrent(playerId, now)
    if (current) return current
    const legacy = loadLegacy(playerId, now)
    if (!legacy) return null
    if (write(legacy)) localStorage.removeItem(LEGACY_PRACTICE_DRAFT_KEY)
    return legacy
  } catch {
    return null
  }
}

export function beginPracticeDraft(run: StartedRun, playerId: string | null): PracticeDraft {
  clearPracticeDraft()
  const draft: PracticeDraft = {
    version: 2,
    playerId,
    run,
    answers: [],
    reviewQueue: [],
    recovered: 0,
    checkpointedAnswers: 0,
    updatedAt: new Date().toISOString()
  }
  write(draft)
  return draft
}

export function restorePracticeDraft(
  playerId: string,
  recovered: Omit<PracticeDraft, 'version' | 'playerId'>
): PracticeDraft | null {
  const draft: PracticeDraft = { version: 2, playerId, ...recovered }
  clearPracticeDraft()
  return write(draft) ? draft : null
}

export function savePracticeDraft(
  draft: PracticeDraft,
  progress: Pick<PracticeDraft, 'answers' | 'reviewQueue' | 'recovered'> & { checkpointedAnswers?: number }
): boolean {
  draft.answers = progress.answers
  draft.reviewQueue = progress.reviewQueue
  draft.recovered = progress.recovered
  if (progress.checkpointedAnswers !== undefined) draft.checkpointedAnswers = progress.checkpointedAnswers
  draft.updatedAt = new Date().toISOString()
  return write(draft)
}

export function practiceDraftDiagnostics(playerId: string | null) {
  const draft = loadPracticeDraft(playerId)
  return draft
    ? {
        runId: draft.run.runId,
        answers: draft.answers.length,
        checkpointedAnswers: draft.checkpointedAnswers,
        updatedAt: draft.updatedAt,
        health: practiceDraftHealth.peek()
      }
    : null
}

export function isPracticeDraftActive(runId: string): boolean {
  try {
    return storedMeta()?.run?.runId === runId
  } catch {
    return false
  }
}

export function clearPracticeDraft(runId?: string): void {
  try {
    const stored = storedMeta()
    if (runId && stored?.run?.runId !== runId) return
    if (stored?.run) {
      for (let index = 0; index < stored.chunkCount; index += 1) {
        localStorage.removeItem(chunkKey(stored.run.runId, index))
      }
    }
    localStorage.removeItem(PRACTICE_DRAFT_KEY)
    localStorage.removeItem(LEGACY_PRACTICE_DRAFT_KEY)
    practiceDraftHealth.value = { state: 'idle' }
  } catch {
    // A corrupt or unavailable store cannot hold a resumable draft.
  }
}
