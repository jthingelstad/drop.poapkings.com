import { useEffect } from 'preact/hooks'
import { COUNTDOWN_ART } from '../RunCountdown'
import { preloadUrls } from '../../lib/preload'

// The pre-countdown hold every mode shows between "the route mounted" and "the
// signed challenge + card art are ready". Deliberately not the GameFrame: there
// is no run to put chrome around yet.
export default function GameLoading({ label = 'Loading cards…' }: { label?: string }) {
  // The countdown frames are fetched here, during the hold, rather than when
  // the countdown mounts — a charge frame that arrives late is worse than no
  // art at all, and this is the last quiet moment before the clock matters.
  useEffect(() => {
    preloadUrls(COUNTDOWN_ART, () => {})
  }, [])

  return (
    <div class="ed-gamewrap ed-gameloading" aria-live="polite">
      <span class="ed-drop-shape ed-gameloading__drop" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
