import { navigate } from '../lib/router'

export type EmptyStateArt = 'empty-runs' | 'empty-board'

// The two empty screens: art, a heading, one line, and — always — a button.
// An empty screen with nothing to press is what makes a new player close the
// app, so the CTA is required, not optional.
//
// Copy stays factual and never implies failure. These fire for players who
// haven't started yet, not players who lost.
//
// Rendered at 132px from the -512 file: the art carries a drop-shadow and needs
// the headroom, so this component does not use the smaller Control Room asset.
export default function EmptyState({
  art,
  heading,
  line,
  actionLabel,
  href,
  onAction
}: {
  art: EmptyStateArt
  heading: string
  line: string
  actionLabel: string
  href?: string
  onAction?: () => void
}) {
  return (
    <div class="ed-empty">
      <img
        src={`/assets/empty/${art}-512.png`}
        alt=""
        aria-hidden="true"
        width={132}
        height={132}
        class="ed-empty__art"
      />
      <strong class="ed-empty__heading">{heading}</strong>
      <span class="ed-empty__line">{line}</span>
      {/* No tap-fx here on purpose. This button always leaves the screen, so
          the destination is the feedback — and a decorative flourish must never
          sit between the player and the only action on an empty page. */}
      <button
        class="ed-btn ed-btn--gold ed-btn--sm ed-empty__cta"
        onClick={() => {
          if (onAction) onAction()
          else if (href) navigate(href)
        }}
      >
        {actionLabel}
      </button>
    </div>
  )
}
