import { useEffect, useRef } from 'preact/hooks'
import type { Signal } from '@preact/signals'

// The two halves of a per-round clock that a player must not be able to cheat.
// Higher/Lower and Survival both need them and both had a byte-similar copy.

interface ShrinkingWindowOptions {
  /** The run is live. The rAF loop only runs while this is true. */
  running: boolean
  /**
   * Per-frame gate. `false` freezes the clock without ending the round — the
   * reveal/answer beat between cards, where the player is not on the hook.
   */
  ticking: () => boolean
  /** `performance.now()` stamp the current round started at (0 = not dealt). */
  startedAt: { current: number }
  /**
   * The current round's window in ms, re-read every frame: both callers tighten
   * it as the streak grows, so deep runs end at the player's real speed ceiling.
   */
  windowMs: () => number
  /** Fraction of the window left (1 → 0). Drives the depleting progress bar. */
  remaining: Signal<number>
  /**
   * The window closed. Fires at most ONCE per round and re-arms when the next
   * round is dealt — Higher/Lower survives a timeout (it costs a life, not the
   * run), so the loop has to outlive the expiry it just reported.
   */
  onExpire: () => void
}

export function useShrinkingWindow({
  running,
  ticking,
  startedAt,
  windowMs,
  remaining,
  onExpire
}: ShrinkingWindowOptions): void {
  // The callbacks close over signals and change identity every render; holding
  // them in a ref keeps the rAF loop from being torn down and restarted (which
  // would silently hand the player a fresh window) on an unrelated re-render.
  const latest = useRef({ ticking, windowMs, onExpire })
  latest.current = { ticking, windowMs, onExpire }

  useEffect(() => {
    if (!running) return
    let raf = 0
    // The round stamp an expiry was already reported for. Each round gets a
    // fresh `performance.now()` stamp, so this both de-duplicates the expiry
    // within a round and re-arms the clock for the next one.
    let expiredAt = 0
    const loop = () => {
      const current = latest.current
      if (current.ticking() && startedAt.current > 0 && startedAt.current !== expiredAt) {
        const frac = 1 - (performance.now() - startedAt.current) / current.windowMs()
        remaining.value = Math.max(0, frac)
        if (frac <= 0) {
          expiredAt = startedAt.current
          current.onExpire()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, startedAt, remaining])
}

// Leaving the tab is not free thinking time. A timed round cannot pause, so
// hiding the page ends the run immediately with the score intact — rather than
// letting the clock burn while hidden and executing the death on the first
// frame back.
export function useEndRunOnHide(active: boolean, onHide: () => void): void {
  const latest = useRef(onHide)
  latest.current = onHide

  useEffect(() => {
    if (!active) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') latest.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [active])
}
