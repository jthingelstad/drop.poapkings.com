import { useRef, useState } from 'preact/hooks'
import { badgeViews, earnedCount, formatRungValue, sortForGrid, type BadgeState, type BadgeView } from '../lib/badges'
import BadgeMedallion from './BadgeMedallion'
import DetailModal from './DetailModal'
import EmptyState from './EmptyState'

// The badge wall: medallions open a real modal, so a tap never changes content
// several screens below the pressed badge.
//
// Grid uses -192 at 74px, the sheet the same file at 84px. -384 is reserved for
// the earn celebration, which is the only place a badge gets big enough to need
// it.
export default function BadgeGrid({ states, earnedOnly = false }: { states: BadgeState[]; earnedOnly?: boolean }) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const views = badgeViews(states)
  const earned = earnedCount(views)
  const visible = earnedOnly ? views.filter((view) => view.earned) : views
  const open = visible.find((view) => view.slug === openSlug)

  if (!earned) {
    if (earnedOnly) {
      return <p class="ed-profile__recent-empty">No badges earned yet.</p>
    }
    return (
      <EmptyState
        art="empty-badges"
        heading="No badges yet"
        line="Every game you finish moves a ladder. The first rungs come quickly."
        actionLabel="Play Surge"
        href="/surge"
      />
    )
  }

  return (
    <>
      <div class="ed-badges__grid">
        {sortForGrid(visible).map((view) => (
          <button
            key={view.slug}
            class="ed-badges__cell"
            onClick={(event) => {
              triggerRef.current = event.currentTarget
              setOpenSlug(view.slug)
            }}
            aria-label={view.concealed ? 'Hidden badge' : `${view.name}${view.chip ? `, ${view.chip}` : ''}`}
          >
            <BadgeMedallion badge={view} size={74} />
            <span class="ed-badges__cell-name">{view.concealed ? 'Hidden badge' : view.name}</span>
          </button>
        ))}
      </div>
      {open && <BadgeSheet badge={open} onClose={() => setOpenSlug(null)} returnFocus={triggerRef.current} />}
    </>
  )
}

function BadgeSheet({
  badge,
  onClose,
  returnFocus
}: {
  badge: BadgeView
  onClose: () => void
  returnFocus: HTMLElement | null
}) {
  const { definition } = badge

  return (
    <DetailModal
      label={badge.concealed ? 'Hidden badge' : badge.name}
      onClose={onClose}
      className="ed-badges__sheet"
      returnFocus={returnFocus}
    >
      <BadgeMedallion badge={badge} size={84} />
      <span class="ed-badges__sheet-name">{badge.concealed ? 'Hidden badge' : badge.name}</span>
      {/* A hidden badge gives away nothing: no name, no requirement, no
            progress bar — and never a "3 of 7 found" count, which would turn the
            mystery into a checklist and make players feel behind. */}
      {badge.concealed ? (
        <span class="ed-badges__sheet-req">Something you have not done yet.</span>
      ) : (
        <>
          {definition.requirement && <span class="ed-badges__sheet-req">{definition.requirement}</span>}
          <div class="ed-badges__ladder">
            {definition.rungs.map((rung, index) => (
              <div key={rung} class={`ed-badges__rung${index <= badge.rungIndex ? ' ed-badges__rung--cleared' : ''}`}>
                <span>{formatRungValue(rung, definition.unit)}</span>
                {/* A time ladder's per-rung run count is the interesting stat:
                      "sub-20s: 14 runs, sub-19s: 9" tells a player exactly where
                      their ceiling is, and makes a fast rung feel earned. */}
                <span class="ed-badges__rung-runs">
                  {badge.runsAtRung?.[index]
                    ? `${badge.runsAtRung[index]} ${badge.runsAtRung[index] === 1 ? 'run' : 'runs'}`
                    : ''}
                </span>
                <span>{index <= badge.rungIndex ? '✓' : ''}</span>
              </div>
            ))}
          </div>
          {badge.nextRung !== undefined && (
            <span class="ed-badges__next">Next: {formatRungValue(badge.nextRung, definition.unit)}</span>
          )}
        </>
      )}
    </DetailModal>
  )
}
