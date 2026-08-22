// Practice's short-term retrieval queue. The weakness-weighted pool is the
// long-term adaptive layer; this queue guarantees that a card missed in this
// session is asked again after other cards have created a real retrieval gap.

export type PracticeReviewStage = 'retry' | 'confirm'

export interface PracticeReviewItem {
  cardId: number
  dueAtAnswered: number
  stage: PracticeReviewStage
}

export interface PracticeReviewOutcome {
  queue: PracticeReviewItem[]
  recovered: boolean
  locked: boolean
}

export const PRACTICE_RETRY_GAP = 4
export const PRACTICE_REPEATED_MISS_GAP = 3
export const PRACTICE_CONFIRM_GAP = 10

export function schedulePracticeReview(
  queue: readonly PracticeReviewItem[],
  cardId: number,
  answered: number,
  stage: PracticeReviewStage,
  gap: number
): PracticeReviewItem[] {
  const next = queue.filter((item) => item.cardId !== cardId)
  next.push({ cardId, dueAtAnswered: answered + Math.max(1, Math.round(gap)), stage })
  return next.sort((left, right) => left.dueAtAnswered - right.dueAtAnswered)
}

export function takeDuePracticeReview(
  queue: readonly PracticeReviewItem[],
  answered: number,
  previousId?: number
): { item?: PracticeReviewItem; queue: PracticeReviewItem[] } {
  const index = queue.findIndex((item) => item.dueAtAnswered <= answered && item.cardId !== previousId)
  if (index < 0) return { queue: [...queue] }
  return {
    item: queue[index],
    queue: queue.filter((_, itemIndex) => itemIndex !== index)
  }
}

export function queuedPracticeCardIds(queue: readonly PracticeReviewItem[]): Set<number> {
  return new Set(queue.map((item) => item.cardId))
}

// Recognition with choices can reinforce a cost, but only an unassisted recall
// advances a missed card from retry to confirmation or clears its confirmation.
export function resolvePracticeReview(
  queue: readonly PracticeReviewItem[],
  cardId: number,
  answered: number,
  stage: PracticeReviewStage | undefined,
  correct: boolean,
  assisted: boolean
): PracticeReviewOutcome {
  if (!stage) {
    return {
      queue: correct ? [...queue] : schedulePracticeReview(queue, cardId, answered, 'retry', PRACTICE_RETRY_GAP),
      recovered: false,
      locked: false
    }
  }

  const withoutCurrent = queue.filter((item) => item.cardId !== cardId)
  if (correct && !assisted) {
    if (stage === 'retry') {
      return {
        queue: schedulePracticeReview(withoutCurrent, cardId, answered, 'confirm', PRACTICE_CONFIRM_GAP),
        recovered: true,
        locked: false
      }
    }
    return { queue: withoutCurrent, recovered: false, locked: true }
  }

  return {
    queue: schedulePracticeReview(
      withoutCurrent,
      cardId,
      answered,
      correct ? stage : 'retry',
      PRACTICE_REPEATED_MISS_GAP
    ),
    recovered: false,
    locked: false
  }
}
