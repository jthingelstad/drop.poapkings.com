import { isReducedMotionEnabled } from './motion'

interface MutableNumber {
  value: number
}

export type TimerList = number[]

export function schedule(timers: TimerList, fn: () => void, ms: number): void {
  timers.push(window.setTimeout(fn, ms))
}

export function clearTimers(timers: TimerList): void {
  timers.forEach(clearTimeout)
  timers.length = 0
}

// 3 · 2 · 1 · GO. Each numeral holds for stepMs; GO is a real frame of its own
// (count 0) that holds for goMs before the run begins, so the first card lands
// on the beat instead of after a dead pause where the "1" used to vanish.
export function startCountdown(
  count: MutableNumber,
  begin: () => void,
  timers: TimerList,
  stepMs: number,
  goMs = GO_HOLD_MS
): void {
  // Reduced motion gets no ticking sequence at all: one still GO frame, held
  // briefly, then the run. Cross-fading four images is exactly the kind of
  // motion the preference is asking us not to play.
  if (isReducedMotionEnabled()) {
    count.value = 0
    schedule(timers, begin, REDUCED_MOTION_GO_MS)
    return
  }

  count.value = 3

  const step = () => {
    if (count.value <= 1) {
      count.value = 0
      schedule(timers, begin, goMs)
      return
    }

    count.value -= 1
    schedule(timers, step, stepMs)
  }

  schedule(timers, step, stepMs)
}

export const GO_HOLD_MS = 250
export const REDUCED_MOTION_GO_MS = 400

export function elapsedWithPenalty(startTime: number, penaltyMs = 0): number {
  return performance.now() - startTime + penaltyMs
}
