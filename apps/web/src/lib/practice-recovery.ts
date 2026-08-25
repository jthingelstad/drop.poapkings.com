import type { CardStats } from '../types'

export interface LearningTotals {
  seen: number
  correct: number
}

export interface PracticeRecoveryCode {
  version: 1
  playerId: string
  observedAt: string
  localSeen: number
  localCorrect: number
  serverSeen: number
  serverCorrect: number
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

export function localLearningTotals(stats: CardStats): LearningTotals {
  return Object.values(stats).reduce(
    (totals, card) => ({
      seen: totals.seen + nonNegativeInteger(card?.seen),
      correct: totals.correct + nonNegativeInteger(card?.correct)
    }),
    { seen: 0, correct: 0 }
  )
}

export function serverLearningTotals(
  costAccuracy: Record<string, { seen: number; correct: number }> | undefined
): LearningTotals {
  return Object.values(costAccuracy ?? {}).reduce(
    (totals, cost) => ({
      seen: totals.seen + nonNegativeInteger(cost?.seen),
      correct: totals.correct + nonNegativeInteger(cost?.correct)
    }),
    { seen: 0, correct: 0 }
  )
}

export function buildPracticeRecoveryCode(
  playerId: string,
  local: LearningTotals,
  server: LearningTotals,
  observedAt = new Date().toISOString()
): PracticeRecoveryCode {
  return {
    version: 1,
    playerId,
    observedAt,
    localSeen: local.seen,
    localCorrect: local.correct,
    serverSeen: server.seen,
    serverCorrect: server.correct
  }
}

export function practiceRecoveryDelta(code: PracticeRecoveryCode): LearningTotals {
  return {
    seen: code.localSeen - code.serverSeen,
    correct: code.localCorrect - code.serverCorrect
  }
}

export function practiceRecoveryState(code: PracticeRecoveryCode): 'found' | 'clear' | 'inconsistent' {
  const delta = practiceRecoveryDelta(code)
  if (
    code.localCorrect > code.localSeen ||
    code.serverCorrect > code.serverSeen ||
    delta.seen < 0 ||
    delta.correct < 0 ||
    delta.correct > delta.seen
  )
    return 'inconsistent'
  return delta.seen > 0 ? 'found' : 'clear'
}

export function serializePracticeRecoveryCode(code: PracticeRecoveryCode): string {
  return JSON.stringify(code, null, 2)
}
