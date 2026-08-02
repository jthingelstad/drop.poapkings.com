import { useEffect, useRef, useState } from 'preact/hooks'
import { track } from '../lib/analytics'
import { badgeViews, earnedCount, formatRungValue, sortForGrid, type BadgeState, type BadgeView } from '../lib/badges'
import { shareBadge } from '../lib/share-badge'
import type { RunShareOutcome } from '../lib/share-run'
import BadgeMedallion from './BadgeMedallion'
import DetailModal from './DetailModal'
import EmptyState from './EmptyState'
import Icon from './Icon'

// The badge wall: medallions open a real modal, so a tap never changes content
// several screens below the pressed badge.
//
// Grid uses -192 at 74px, the sheet the same file at 84px. -384 is reserved for
// the earn celebration, which is the only place a badge gets big enough to need
// it.
export default function BadgeGrid({
  states,
  earnedOnly = false,
  playerId,
  playerName
}: {
  states: BadgeState[]
  earnedOnly?: boolean
  playerId?: string
  playerName?: string
}) {
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
      {open && (
        <BadgeSheet
          badge={open}
          playerId={playerId}
          playerName={playerName}
          onClose={() => setOpenSlug(null)}
          returnFocus={triggerRef.current}
        />
      )}
    </>
  )
}

function BadgeSheet({
  badge,
  playerId,
  playerName,
  onClose,
  returnFocus
}: {
  badge: BadgeView
  playerId?: string
  playerName?: string
  onClose: () => void
  returnFocus: HTMLElement | null
}) {
  const { definition } = badge
  const [sharing, setSharing] = useState(false)
  const [outcome, setOutcome] = useState<RunShareOutcome | null>(null)
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function share() {
    if (!playerId || !playerName || sharing) return
    setSharing(true)
    setOutcome(null)
    const result = await shareBadge({
      slug: badge.slug,
      name: badge.name,
      chip: badge.chip,
      tier: badge.tier,
      requirement: definition.requirement,
      playerId,
      playerName
    })
    setSharing(false)
    setOutcome(result === 'cancelled' ? null : result)
    if (result === 'shared' || result === 'copied') {
      track('badge.shared')
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setOutcome(null), 1800)
    }
  }

  const shareLabel = sharing
    ? 'Opening…'
    : outcome === 'shared'
      ? 'Shared'
      : outcome === 'copied'
        ? 'Copied'
        : 'Share badge'

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
          {badge.earned && playerId && playerName && (
            <div class="ed-badges__share">
              <button class="ed-btn ed-btn--ghost ed-badges__share-btn" disabled={sharing} onClick={() => void share()}>
                <Icon name={outcome === 'shared' || outcome === 'copied' ? 'check' : 'share'} />
                {shareLabel}
              </button>
              <span class="ed-badges__share-status" aria-live="polite">
                {outcome === 'copied' && 'Native sharing is unavailable, so the badge was copied.'}
                {outcome === 'unavailable' && 'Sharing is unavailable in this browser.'}
                {outcome === 'shared' && 'Badge shared.'}
              </span>
            </div>
          )}
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
