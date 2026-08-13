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

export default function ReviewStatusMark({ status, compact = false }: { status: ReviewStatus; compact?: boolean }) {
  const label = LABELS[status]
  return (
    <span class={`ed-review-status ed-review-status--${status}`} title={label.accessible}>
      <span role="img" aria-label={label.accessible}>
        {GLYPHS[status]}
      </span>
      {!compact && (
        <span class="ed-review-status__label" aria-hidden="true">
          {label.visible}
        </span>
      )}
    </span>
  )
}
