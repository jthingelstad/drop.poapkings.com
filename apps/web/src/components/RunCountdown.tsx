import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'
import { playCountdownTick } from '../lib/sound'

// In-slot countdown: the number lands where the first card will, so a mode's
// interface is already drawn and nothing reflows when the card arrives. Shared
// by the timed modes (Surge, Survival…).

export default function RunCountdown({ count }: { count: number }) {
  const numberRef = useRef<HTMLSpanElement>(null)
  // Count 0 is the GO beat, not a zero to display.
  const isGo = count <= 0
  const label = isGo ? 'Go' : `Starting in ${count}`

  useEffect(() => {
    const element = numberRef.current
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
    return () => {
      pop.stop()
    }
  }, [count, isGo])

  return (
    <div class="run-count" aria-live="assertive" aria-label={label}>
      <span class={`run-count__num${isGo ? ' run-count__num--go' : ''}`} ref={numberRef}>
        {isGo ? 'GO' : count}
      </span>
    </div>
  )
}
