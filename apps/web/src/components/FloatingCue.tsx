import { animate } from 'motion'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../lib/motion'

// A transient feedback cue painted OVER the game, never in layout flow, so game
// feedback (penalties, hints, streaks) can never reflow the board mid-tap. Each
// new `trigger` value normally replays a rise-and-fade via the motion library;
// a persistent cue instead enters once and remains readable until unmounted.
// Shared by every mode for consistent feel.
//
// Its slot must be positioned (`.game-cues__*`); the cue animates its own
// transform, so wrap it in a slot that handles anchoring/centering.
export default function FloatingCue({
  trigger,
  className = '',
  testId,
  persistent = false,
  // How long a non-persistent cue lives. It must not outlive the card it is
  // about: a correct answer advances the card in ~280ms, so a 900ms cue drifts
  // over the NEXT card. Fast per-tap cues (penalty, hint) pass a short hold; a
  // slower informational cue (the pace ghost) keeps the default.
  holdMs = 900,
  children
}: {
  trigger: number
  className?: string
  testId?: string
  persistent?: boolean
  holdMs?: number
  children: ComponentChildren
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handled = useRef(0)

  useEffect(() => {
    const element = ref.current
    if (!element || trigger === 0 || trigger === handled.current) return
    handled.current = trigger
    if (persistent) {
      const keyframes = isReducedMotionEnabled()
        ? { opacity: [0, 1] }
        : { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] }
      void animate(element, keyframes, { duration: 0.18, ease: 'easeOut' })
      return
    }
    const duration = holdMs / 1000
    if (isReducedMotionEnabled()) {
      void animate(element, { opacity: [0, 1, 1, 0] }, { duration })
      return
    }
    void animate(
      element,
      {
        opacity: [0, 1, 1, 0],
        transform: ['translateY(12px)', 'translateY(0)', 'translateY(-8px)', 'translateY(-22px)']
      },
      { duration, ease: 'easeOut' }
    )
  }, [holdMs, persistent, trigger])

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
