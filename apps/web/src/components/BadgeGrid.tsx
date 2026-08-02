import { useState } from 'preact/hooks'
import { badgeViews, earnedCount, formatRungValue, sortForGrid, type BadgeState, type BadgeView } from '../lib/badges'
import BadgeMedallion from './BadgeMedallion'
import EmptyState from './EmptyState'

// The badge wall: 29 medallions, then a detail sheet for whichever one you tap.
//
// Grid uses -192 at 74px, the sheet the same file at 84px. -384 is reserved for
// the earn celebration, which is the only place a badge gets big enough to need
// it.
export default function BadgeGrid({ states }: { states: BadgeState[] }) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const views = badgeViews(states)
  const earned = earnedCount(views)
  const open = views.find((view) => view.slug === openSlug)

  if (!earned) {
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
        {sortForGrid(views).map((view) => (
          <button
            key={view.slug}
            class="ed-badges__cell"
            onClick={() => setOpenSlug(view.slug)}
            aria-label={view.concealed ? 'Hidden badge' : `${view.name}${view.chip ? `, ${view.chip}` : ''}`}
          >
            <BadgeMedallion badge={view} size={74} />
            <span class="ed-badges__cell-name">{view.concealed ? 'Hidden badge' : view.name}</span>
          </button>
        ))}
      </div>
      {open && <BadgeSheet badge={open} onClose={() => setOpenSlug(null)} />}
    </>
  )
}

function BadgeSheet({ badge, onClose }: { badge: BadgeView; onClose: () => void }) {
  const { definition } = badge
  return (
    <div class="ed-badges__sheet" role="group" aria-label={badge.concealed ? 'Hidden badge' : badge.name}>
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
      <button class="ed-textlink" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
