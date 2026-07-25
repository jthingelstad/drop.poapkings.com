import { animate } from 'motion'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../../lib/motion'

// Rain milestone flash: every 10 clears the running total pulses once in the
// middle of the field and is gone in ~0.5s. Deliberately echoes the 3-2-1
// RunCountdown look (gold display numeral + expanding ring) so it reads as the
// same voice, but it is purely informational — the authoritative count already
// lives in the top-bar metric, so this is aria-hidden and never announced.
//
// Composited over the falling field, never in layout flow (see CLAUDE.md), so a
// milestone can never reflow the board mid-tap. The component animates on mount;
// the parent mounts it by setting a milestone value and unmounts it on a timer.
export default function RainMilestone({ value }: { value: number }) {
  const numberRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = numberRef.current
    if (!element) return
    if (isReducedMotionEnabled()) {
      // Reduced motion still gets the information, just as a flat quick fade.
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
    <div class="ed-rain__milestone" aria-hidden="true">
      <span class="ed-rain__milestone-ring" />
      <span class="ed-rain__milestone-num" ref={numberRef}>
        {value}
      </span>
    </div>
  )
}
