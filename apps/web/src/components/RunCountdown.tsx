import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'
import { playCountdownTick } from '../lib/sound'

// In-slot countdown: the number lands where the first card will, so a mode's
// interface is already drawn and nothing reflows when the card arrives. Each tick
// pops the digit in with the motion lib; a CSS ring pulses out behind it. Reduced
// motion keeps a plain, quick fade. Shared by the timed modes (Surge, Survival…).
//
// Behind the numeral sits the painted charge art. All four frames are mounted at
// once, stacked on the same centre, and only their opacity moves — that is what
// makes them sequence without a jump, and it means the browser has fetched every
// frame before the one that needs it. The numeral keeps its scale-and-pop; the
// art only cross-fades, because two things moving at once turns a crisp beat to
// mush.
const FRAMES = [
  { count: 3, src: '/assets/start/charge-3-512.png' },
  { count: 2, src: '/assets/start/charge-2-512.png' },
  { count: 1, src: '/assets/start/charge-1-512.png' },
  { count: 0, src: '/assets/start/charge-go-512.png' }
] as const

export const COUNTDOWN_ART = FRAMES.map((frame) => frame.src)

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
    return () => pop.stop()
  }, [count, isGo])

  return (
    <div class="run-count" aria-live="assertive" aria-label={label}>
      <span class="run-count__art" aria-hidden="true">
        {FRAMES.map((frame) => (
          <img
            key={frame.count}
            src={frame.src}
            alt=""
            width={512}
            height={512}
            // Reduced motion collapses the whole sequence to the GO frame: no
            // ticking art, one still image under the numeral.
            class={`run-count__frame${frame.count === count ? ' run-count__frame--on' : ''}`}
            data-frame={frame.count}
          />
        ))}
      </span>
      <span class="run-count__ring" key={count} aria-hidden="true" />
      <span class={`run-count__num${isGo ? ' run-count__num--go' : ''}`} ref={numberRef}>
        {isGo ? 'GO' : count}
      </span>
    </div>
  )
}
