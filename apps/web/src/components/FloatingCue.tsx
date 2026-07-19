import { animate } from 'motion'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'

// A transient feedback cue painted OVER the game, never in layout flow, so game
// feedback (penalties, hints, streaks) can never reflow the board mid-tap. Each
// new `trigger` value replays a rise-and-fade via the motion library; between
// plays the cue rests invisible. Shared by every mode for consistent feel.
//
// Its slot must be positioned (`.game-cues__*`); the cue animates its own
// transform, so wrap it in a slot that handles anchoring/centering.
export default function FloatingCue({
  trigger,
  className = '',
  testId,
  children
}: {
  trigger: number
  className?: string
  testId?: string
  children: ComponentChildren
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handled = useRef(0)

  useEffect(() => {
    const element = ref.current
    if (!element || trigger === 0 || trigger === handled.current) return
    handled.current = trigger
    if (isReducedMotionEnabled()) {
      void animate(element, { opacity: [0, 1, 1, 0] }, { duration: 0.9 })
      return
    }
    void animate(
      element,
      {
        opacity: [0, 1, 1, 0],
        transform: ['translateY(12px)', 'translateY(0)', 'translateY(-8px)', 'translateY(-22px)']
      },
      { duration: 0.9, ease: 'easeOut' }
    )
  }, [trigger])

  return (
    <div
      ref={ref}
      class={`floating-cue ${className}`.trim()}
      data-testid={testId}
      aria-hidden="true"
      style={{ opacity: 0 }}
    >
      {children}
    </div>
  )
}
