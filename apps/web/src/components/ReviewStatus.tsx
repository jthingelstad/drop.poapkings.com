export type ReviewStatus = 'pending' | 'reviewed' | 'excluded'

const GLYPHS: Record<ReviewStatus, string> = {
  pending: String.fromCodePoint(0x1f50e),
  reviewed: String.fromCodePoint(0x2705),
  excluded: String.fromCodePoint(0x1f6ab)
}

const LABELS: Record<ReviewStatus, string> = {
  pending: 'Review pending',
  reviewed: 'Referee reviewed',
  excluded: 'Not included in rankings'
}

export default function ReviewStatusMark({ status }: { status: ReviewStatus }) {
  const label = LABELS[status]
  return (
    <span class={`ed-review-status ed-review-status--${status}`} role="img" aria-label={label} title={label}>
      {GLYPHS[status]}
    </span>
  )
}
