import { signal } from '@preact/signals'
import { earnedBadges } from '../lib/use-game-run'
import { currentInterrupt } from '../lib/interrupt-ladder'
import { player } from '../lib/account'
import { prepareBadgeShare } from '../lib/share-badge'
import { track } from '../lib/analytics'
import BadgeMedallion from './BadgeMedallion'
import { earnedRungViews, type EarnedRung } from './BadgeEarned'
import ShareAction from './ShareAction'

function batchKey(earned: EarnedRung[]): string {
  return earned.map((rung) => `${rung.slug}:${rung.rungIndex}`).join(',')
}

// The one takeover left (tier 1). Badges moved to their own scope and grew rungs,
// but nothing ever TOLD a player they cleared one — it arrived as a row in a grid
// they had to go looking at. This does, on the summary after a run: the medallion
// at its real tier, the rung reached, a share, and "Carry on". The ladder
// guarantees this is the only overlay that can take the screen, and only on a
// summary.
const dismissedKey = signal<string | null>(null)

export default function BadgeCelebration() {
  const earned = earnedBadges.value
  const key = batchKey(earned)
  if (currentInterrupt.value !== 1 || !earned.length || dismissedKey.value === key) return null
  const views = earnedRungViews(earned)
  if (!views.length) return null
  const view = views[0]
  const current = player.value
  const canShare = Boolean(current?.id && current.publicName)

  return (
    <div class="badge-celebrate" role="dialog" aria-modal="true" aria-label={`${view.name} earned`}>
      <div class="badge-celebrate__card">
        <div class="badge-celebrate__eyebrow">Rung cleared</div>
        <div class="badge-celebrate__medal">
          <BadgeMedallion badge={view} size={172} file={384} />
        </div>
        <div class="badge-celebrate__name">{view.name}</div>
        {view.chip && <div class="badge-celebrate__chip">{view.chip}</div>}
        {views.length > 1 && <div class="badge-celebrate__more">and {views.length - 1} more this run</div>}
        <div class="badge-celebrate__actions">
          {canShare && (
            <ShareAction
              prepare={() => prepareBadgeShare({ slug: view.slug, rungIndex: view.rungIndex })}
              className="ed-link-action ed-link-action--celebration"
              onComplete={() => track('badge.shared')}
            />
          )}
          <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => (dismissedKey.value = key)}>
            <span class="tap-face">Carry on</span>
          </button>
        </div>
      </div>
    </div>
  )
}
