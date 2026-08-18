import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'
import { playCountdownTick } from '../lib/sound'

// In-slot countdown: the number lands where the first card will, so a mode's
// interface is already drawn and nothing reflows when the card arrives. Behind
// the numeral sits the matching "charge" frame (3 · 2 · 1 · GO): it holds still
// and only cross-fades while the numeral pops — two things moving at once turns
// a crisp beat into mush. All four frames share a centre and are preloaded when
// the start screen mounts (`preloadCountdownFrames`), so the src swap is instant.
// Reduced motion shows a single still GO frame (the driver skips the sequence).
// Shared by the timed modes (Surge, Survival…).

function chargeFrame(count: number): string {
  return `/assets/start/charge-${count <= 0 ? 'go' : count}-512.png`
}

export default function RunCountdown({ count }: { count: number }) {
  const numberRef = useRef<HTMLSpanElement>(null)
  const artRef = useRef<HTMLImageElement>(null)
  // Count 0 is the GO beat, not a zero to display.
  const isGo = count <= 0
  const label = isGo ? 'Go' : `Starting in ${count}`

  useEffect(() => {
    const element = numberRef.current
    const art = artRef.current
    if (!element) return
    if (!isGo) playCountdownTick()
    if (isReducedMotionEnabled()) {
      const fade = animate(element, { opacity: [0.6, 1] }, { duration: 0.12, ease: 'easeOut' })
      return () => fade.stop()
    }
    const pop = animate(
      element,
      {
        opacity: [0, 1, 1, 0.85],
        transform: ['scale(1.7)', 'scale(1)', 'scale(1)', 'scale(0.86)']
      },
      { duration: 0.6, ease: [0.22, 0.8, 0.24, 1] }
    )
    // The art only cross-fades; the numeral carries all the movement.
    const artFade = art ? animate(art, { opacity: [0, 1] }, { duration: 0.12, ease: 'easeOut' }) : null
    return () => {
      pop.stop()
      artFade?.stop()
    }
  }, [count, isGo])

  return (
    <div class="run-count" aria-live="assertive" aria-label={label}>
      <img
        ref={artRef}
        class="run-count__art"
        src={chargeFrame(count)}
        alt=""
        aria-hidden="true"
        width={280}
        height={280}
      />
      <span class={`run-count__num${isGo ? ' run-count__num--go' : ''}`} ref={numberRef}>
        {isGo ? 'GO' : count}
      </span>
    </div>
  )
}
