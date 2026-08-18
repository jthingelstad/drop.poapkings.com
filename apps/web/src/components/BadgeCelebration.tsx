import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { earnedBadges } from '../lib/use-game-run'
import { currentInterrupt } from '../lib/interrupt-ladder'
import { player } from '../lib/account'
import { isReducedMotionEnabled } from '../lib/motion'
import { shareBadge } from '../lib/share-badge'
import { track } from '../lib/analytics'
import BadgeMedallion from './BadgeMedallion'
import { earnedRungViews, type EarnedRung } from './BadgeEarned'
import Icon from './Icon'

function batchKey(earned: EarnedRung[]): string {
  return earned.map((rung) => `${rung.slug}:${rung.rungIndex}`).join(',')
}

// The one takeover left (tier 1). Badges moved to their own scope and grew rungs,
// but nothing ever TOLD a player they cleared one — it arrived as a row in a grid
// they had to go looking at. This does, on the summary after a run: the medallion
// at its real tier, the rung reached, a share, and "Carry on". charge-go doubles
// as the burst behind it — the same file the run-start plays, so the two moments
// feel related. The ladder guarantees this is the only overlay that can take the
// screen, and only on a summary.
const dismissedKey = signal<string | null>(null)

export default function BadgeCelebration() {
  const [sharing, setSharing] = useState(false)
  const earned = earnedBadges.value
  const key = batchKey(earned)
  if (currentInterrupt.value !== 1 || !earned.length || dismissedKey.value === key) return null
  const views = earnedRungViews(earned)
  if (!views.length) return null
  const view = views[0]
  const current = player.value
  const canShare = Boolean(current?.id && current.publicName)

  const share = async () => {
    if (!current?.id || !current.publicName || sharing) return
    setSharing(true)
    const outcome = await shareBadge({
      slug: view.slug,
      name: view.name,
      chip: view.chip,
      tier: view.tier,
      requirement: view.definition.requirement,
      playerId: current.id,
      playerName: current.publicName
    })
    setSharing(false)
    if (outcome === 'shared' || outcome === 'copied') track('badge.shared')
  }

  return (
    <div class="badge-celebrate" role="dialog" aria-modal="true" aria-label={`${view.name} earned`}>
      <div class="badge-celebrate__card">
        <div class="badge-celebrate__eyebrow">Rung cleared</div>
        <div class="badge-celebrate__medal">
          {!isReducedMotionEnabled() && (
            <img class="badge-celebrate__burst" src="/assets/start/charge-go-512.png" alt="" aria-hidden="true" />
          )}
          <BadgeMedallion badge={view} size={172} file={384} />
        </div>
        <div class="badge-celebrate__name">{view.name}</div>
        {view.chip && <div class="badge-celebrate__chip">{view.chip}</div>}
        {views.length > 1 && <div class="badge-celebrate__more">and {views.length - 1} more this run</div>}
        <div class="badge-celebrate__actions">
          {canShare && (
            <button class="ed-btn ed-btn--ghost" disabled={sharing} onClick={() => void share()}>
              <Icon name="share" /> {sharing ? 'Opening…' : 'Share badge'}
            </button>
          )}
          <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => (dismissedKey.value = key)}>
            <span class="tap-face">Carry on</span>
          </button>
        </div>
      </div>
    </div>
  )
}
