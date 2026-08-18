import { reloadToLatest } from '../lib/version'
import { currentInterrupt, updateStripDismissed } from '../lib/interrupt-ladder'
import Icon from './Icon'

// Tier 4: a strip above the nav pill announcing a newer front-end build. It has
// NO scrim and NO blur — the page behind stays fully lit and usable; the strip
// carries its own opaque background, so it stays legible without dimming
// anything. That is the visible difference between a tier-4 strip and the tier-1
// takeover. The interrupt ladder shows it only on idle screens (never over a run
// or a summary), and it is dismissible for the session.
export default function UpdateBanner() {
  if (currentInterrupt.value !== 4) return null
  return (
    <aside class="update-strip" role="status" aria-live="polite">
      <Icon name="sparkles" className="update-strip__icon" />
      <div class="update-strip__copy">
        <strong>A new version of Elixir Drop is ready.</strong>
        <span>Reload for the latest games and fixes.</span>
      </div>
      <button class="ed-btn ed-btn--gold ed-btn--sm" onClick={reloadToLatest}>
        Reload
      </button>
      <button
        class="update-strip__x"
        aria-label="Dismiss update notice"
        onClick={() => (updateStripDismissed.value = true)}
      >
        <Icon name="x" />
      </button>
    </aside>
  )
}
