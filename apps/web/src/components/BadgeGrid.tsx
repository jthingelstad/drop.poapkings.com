import { useRef, useState } from 'preact/hooks'
import { badgeTier } from '@elixir-drop/contracts'
import { track } from '../lib/analytics'
import { badgeViews, earnedCount, formatRungValue, sortForGrid, type BadgeState, type BadgeView } from '../lib/badges'
import { prepareBadgeShare } from '../lib/share-badge'
import { player } from '../lib/account'
import BadgeMedallion from './BadgeMedallion'
import DetailModal from './DetailModal'
import ShareAction from './ShareAction'

// The badge wall: medallions open a real modal, so a tap never changes content
// several screens below the pressed badge.
//
// Grid uses -192 at 74px, the sheet the same file at 84px. -384 is reserved for
// the earn celebration, which is the only place a badge gets big enough to need
// it.
// `featured` is the You page's condensed strip: the first few badges at medal
// size with no captions. The full wall is one tap away, so the strip trims what
// is shown, never what exists.
const FEATURED_BADGES = 6

export default function BadgeGrid({
  states,
  earnedOnly = false,
  featured = false,
  playerId,
  playerName
}: {
  states: BadgeState[]
  earnedOnly?: boolean
  featured?: boolean
  playerId?: string
  playerName?: string
}) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const views = badgeViews(states)
  const earned = earnedCount(views)
  const scoped = earnedOnly ? views.filter((view) => view.earned) : views
  const ordered = sortForGrid(scoped)
  const visible = featured ? ordered.slice(0, FEATURED_BADGES) : ordered
  const open = visible.find((view) => view.slug === openSlug)

  // Only the earned-only view (a public profile) collapses to a line when empty.
  // The full Badges scope always shows the whole set — locked and silhouetted —
  // because a set you cannot see whole is not a set: a new player should see the
  // ladders waiting for them, not a blank screen.
  if (!earned && earnedOnly) {
    return <p class="ed-profile__recent-empty">No badges earned yet.</p>
  }

  return (
    <>
      <div class={featured ? 'ed-badges__grid ed-badges__grid--featured' : 'ed-badges__grid'}>
        {visible.map((view) => (
          <button
            key={view.slug}
            class="ed-badges__cell"
            onClick={(event) => {
              triggerRef.current = event.currentTarget
              setOpenSlug(view.slug)
            }}
            aria-label={`${view.name}${view.chip ? `, ${view.chip}` : ''}`}
          >
            <BadgeMedallion badge={view} size={featured ? 44 : 74} />
            {!featured && <span class="ed-badges__cell-name">{view.name}</span>}
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

export function BadgeSheet({
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
  const ownsBadge = Boolean(playerId && playerName && player.value?.id === playerId)
  const showsProgress = definition.progressive !== false

  return (
    <DetailModal label={badge.name} onClose={onClose} className="ed-badges__sheet" returnFocus={returnFocus}>
      <BadgeMedallion badge={badge} size={84} />
      <span class="ed-badges__sheet-name">{badge.name}</span>
      {/* A locked secret reveals its name, but not the earning condition or
          progress. It also never exposes a "3 of 7 found" count, which would
          turn discovery into a checklist and make players feel behind. */}
      {badge.concealed ? (
        <span class="ed-badges__sheet-req">Secret badge — earn it to reveal how.</span>
      ) : (
        <>
          {definition.requirement && <span class="ed-badges__sheet-req">{definition.requirement}</span>}
          {badge.earned && ownsBadge && (
            <ShareAction
              prepare={() => prepareBadgeShare({ slug: badge.slug, rungIndex: badge.rungIndex })}
              className="ed-badges__permalink"
              buttonClassName="ed-btn ed-btn--ghost ed-badges__permalink-btn"
              statusClassName="ed-badges__permalink-status"
              onComplete={() => track('badge.shared')}
            />
          )}
          {showsProgress && (
            <>
              <div class="ed-badges__milestone">
                <div class="ed-badges__milestone-head">
                  <span class="ed-badges__milestone-kicker">
                    {badge.nextRung === undefined ? 'Milestones complete' : 'Next milestone'}
                  </span>
                  <strong class="ed-badges__milestone-value">
                    {formatRungValue(badge.nextRung ?? badge.value, definition.unit)}
                  </strong>
                </div>
                {(badge.value > 0 || definition.kind !== 'time') && (
                  <>
                    <span
                      class="ed-badges__progress"
                      role="progressbar"
                      aria-label={`${badge.name} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(badge.progress * 100)}
                      aria-valuetext={progressLabel(badge)}
                    >
                      <span class="ed-badges__progress-fill" style={{ width: `${badge.progress * 100}%` }} />
                    </span>
                    <span class="ed-badges__progress-label">{progressLabel(badge)}</span>
                  </>
                )}
              </div>
              <RungLadder badge={badge} />
            </>
          )}
        </>
      )}
    </DetailModal>
  )
}

// The full ladder under the progress bar: one segment per rung in the badge's
// own units. Cleared rungs show in their tier metal, the next rung to reach is
// gold, the rest are dark — so a player reads the whole climb, not just the next
// step. "Clockbreaker 19s" says something a roman numeral never could.
function RungLadder({ badge }: { badge: BadgeView }) {
  const { definition, rungIndex } = badge
  const total = definition.rungs.length
  const tierName = badge.tier.charAt(0).toUpperCase() + badge.tier.slice(1)
  return (
    <div class="ed-badges__rungs">
      <div class="ed-badges__rungs-head">
        Rung {Math.max(0, rungIndex + 1)} of {total}
        {rungIndex >= 0 && ` · ${tierName}`}
      </div>
      <div class={`ed-badges__rungs-track${total > 12 ? ' ed-badges__rungs-track--long' : ''}`}>
        {definition.rungs.map((rung, i) => {
          const seg =
            i === rungIndex + 1
              ? 'ed-badges__rung-seg--current'
              : i <= rungIndex
                ? `ed-badges__rung-seg--tier-${badgeTier(i, total)}`
                : 'ed-badges__rung-seg--remaining'
          return (
            <div class="ed-badges__rung" key={i}>
              <span class={`ed-badges__rung-seg ${seg}`} />
              <span class="ed-badges__rung-num">{formatRungValue(rung, definition.unit)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function progressLabel(badge: BadgeView): string {
  const current = formatRungValue(badge.value, badge.definition.unit)
  const valueLabel = badge.definition.kind === 'count' ? 'Current' : 'Best'
  if (badge.nextRung === undefined) return `${valueLabel}: ${current} · all milestones achieved`
  const remaining = badge.definition.kind === 'time' ? badge.value - badge.nextRung : badge.nextRung - badge.value
  const toNext = formatRungValue(Math.max(0, remaining), badge.definition.unit)
  if (badge.definition.kind === 'time') {
    return `Best: ${current} · ${toNext} faster to go`
  }
  return `${valueLabel}: ${current} · ${toNext} to go`
}
