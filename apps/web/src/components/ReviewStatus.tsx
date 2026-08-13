export type ReviewStatus = 'pending' | 'reviewed' | 'excluded'

const GLYPHS: Record<ReviewStatus, string> = {
  pending: String.fromCodePoint(0x1f50e),
  reviewed: String.fromCodePoint(0x2705),
  excluded: String.fromCodePoint(0x1f6ab)
}

const LABELS: Record<ReviewStatus, { visible: string; accessible: string }> = {
  pending: { visible: 'Pending', accessible: 'Review pending' },
  reviewed: { visible: 'Reviewed', accessible: 'Referee reviewed' },
  excluded: { visible: 'Excluded', accessible: 'Not included in rankings' }
}

export default function ReviewStatusMark({ status }: { status: ReviewStatus }) {
  const label = LABELS[status]
  return (
    <span class={`ed-review-status ed-review-status--${status}`} aria-label={label.accessible} title={label.accessible}>
      <span aria-hidden="true">{GLYPHS[status]}</span>
      <span class="ed-review-status__label">{label.visible}</span>
    </span>
  )
}
