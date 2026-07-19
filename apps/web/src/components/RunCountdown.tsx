import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'

// In-slot countdown: the number lands where the first card will, so a mode's
// interface is already drawn and nothing reflows when the card arrives. Each tick
// pops the digit in with the motion lib; a CSS ring pulses out behind it. Reduced
// motion keeps a plain, quick fade. Shared by the timed modes (Surge, Survival…).
export default function RunCountdown({ count }: { count: number }) {
  const numberRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = numberRef.current
    if (!element) return
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
    return () => pop.stop()
  }, [count])

  return (
    <div class="run-count" aria-live="assertive" aria-label={`Starting in ${count}`}>
      <span class="run-count__ring" key={count} aria-hidden="true" />
      <span class="run-count__num" ref={numberRef}>
        {count}
      </span>
    </div>
  )
}
