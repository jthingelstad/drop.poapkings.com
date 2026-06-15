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

export function startCountdown(count: MutableNumber, begin: () => void, timers: TimerList, stepMs: number): void {
  count.value = 3

  const step = () => {
    if (count.value <= 1) {
      begin()
      return
    }

    count.value -= 1
    schedule(timers, step, stepMs)
  }

  schedule(timers, step, stepMs)
}

export function elapsedWithPenalty(startTime: number, penaltyMs = 0): number {
  return performance.now() - startTime + penaltyMs
}
