import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'

// Shared every-10 progress flash for long-running modes. It echoes the 3-2-1
// countdown's gold display numeral, stays out of layout flow, and remains
// informational because each mode's top-bar metric is authoritative.
export default function GameMilestone({ value }: { value: number }) {
  const numberRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = numberRef.current
    if (!element) return
    if (isReducedMotionEnabled()) {
      const fade = animate(element, { opacity: [0, 1] }, { duration: 0.12, ease: 'easeOut' })
      return () => fade.stop()
    }
    const pop = animate(
      element,
      {
        opacity: [0, 1, 1, 0],
        transform: ['scale(1.5)', 'scale(1)', 'scale(1)', 'scale(1.18)']
      },
      { duration: 0.5, ease: [0.22, 0.8, 0.24, 1] }
    )
    return () => pop.stop()
  }, [value])

  return (
    <div class="game-milestone" aria-hidden="true">
      <span class="game-milestone__ring" />
      <span class="game-milestone__num" ref={numberRef}>
        {value}
      </span>
    </div>
  )
}
