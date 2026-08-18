import type { JSX } from 'preact'

export type ReviewStatus = 'pending' | 'reviewed' | 'excluded'

// The client seal has a fourth face the API enum never carries: NOT RECORDED,
// for a run the board never saw (offline or guest). It is a client-only state —
// the server enum stays pending | reviewed | excluded — so it is a superset,
// not a widening of the API contract.
export type ReviewSeal = ReviewStatus | 'not-recorded'

// The five sizes the mark is actually struck at: two list sizes (history row,
// board row), the rank-1 size, and two display sizes (summary, Fair Play).
// Keeping this a union stops a sixth arbitrary size appearing in one screen.
export type ReviewStatusSize = 18 | 26 | 32 | 72 | 92

const LABELS: Record<ReviewSeal, { word: string; accessible: string }> = {
  pending: { word: 'Awaiting', accessible: 'Awaiting referee' },
  reviewed: { word: 'Cleared', accessible: 'Referee cleared' },
  excluded: { word: 'Excluded', accessible: 'Not ranked' },
  'not-recorded': { word: 'Not recorded', accessible: 'Not recorded' }
}

// A wax seal is struck by hand, so no two sit at the same angle. Cycling three
// rotations by row index keeps a column of seals from reading as printed.
const ROTATIONS = [-9, 6, -6]

export default function ReviewStatusMark({
  status,
  size = 26,
  label = false,
  index = 0,
  struck = false
}: {
  status: ReviewSeal
  size?: ReviewStatusSize
  /** Renders the status word beside the mark. The mark alone is the default. */
  label?: boolean
  /** Row index, so a list of seals alternates its rotation. */
  index?: number
  /** Plays the press-in strike once, where the mark is the moment (summary). */
  struck?: boolean
}) {
  const copy = LABELS[status]
  // The awaiting ring is a stamp that has not landed yet, and NOT RECORDED is a
  // dotted ring no decision was ever pending on: never rotate either.
  const rotation = status === 'pending' || status === 'not-recorded' ? 0 : ROTATIONS[index % ROTATIONS.length]
  return (
    <span class={`ed-review-status ed-review-status--${status}`} title={copy.accessible}>
      <span
        class={`ed-seal ed-seal--${status}${struck ? ' ed-seal--struck' : ''}`}
        role="img"
        aria-label={copy.accessible}
        style={
          {
            '--seal-size': `${size}px`,
            '--seal-rotation': `${rotation}deg`
          } as JSX.CSSProperties
        }
      />
      {label && (
        <span class="ed-review-status__word" aria-hidden="true">
          {copy.word}
        </span>
      )}
    </span>
  )
}
