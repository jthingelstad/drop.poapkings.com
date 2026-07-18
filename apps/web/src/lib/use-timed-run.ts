import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { clearTimers, elapsedWithPenalty, schedule, startCountdown, type TimerList } from './run-loop'

export type TimedRunStage = 'ready' | 'countdown' | 'running' | 'summary'

interface TimedRunOptions {
  countdownStepMs: number
  durationMs?: number
  onDurationEnd?: () => void
}

export function useTimedRun({ countdownStepMs, durationMs, onDurationEnd }: TimedRunOptions) {
  const stage = useSignal<TimedRunStage>('ready')
  const count = useSignal(3)
  const elapsedMs = useSignal(durationMs ?? 0)
  const startTime = useRef(0)
  const penaltyMs = useRef(0)
  const timers = useRef<TimerList>([])
  const onDurationEndRef = useRef(onDurationEnd)
  onDurationEndRef.current = onDurationEnd

  useEffect(() => {
    const timerList = timers.current
    return () => clearTimers(timerList)
  }, [])

  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0

    const loop = () => {
      const elapsed = elapsedWithPenalty(startTime.current, penaltyMs.current)
      if (durationMs !== undefined) {
        const left = durationMs - elapsed
        elapsedMs.value = Math.max(0, left)
        if (left <= 0) {
          onDurationEndRef.current?.()
          return
        }
      } else {
        elapsedMs.value = elapsed
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [durationMs, elapsedMs, stage.value])

  function later(fn: () => void, ms: number): void {
    schedule(timers.current, fn, ms)
  }

  function clearScheduled(): void {
    clearTimers(timers.current)
  }

  function setStage(next: TimedRunStage): void {
    stage.value = next
  }

  function reset(nextStage: TimedRunStage = 'ready'): void {
    clearScheduled()
    startTime.current = 0
    penaltyMs.current = 0
    count.value = 3
    elapsedMs.value = durationMs ?? 0
    stage.value = nextStage
  }

  function start(onBegin?: (startedAt: number) => void): void {
    stage.value = 'countdown'
    startCountdown(
      count,
      () => {
        const startedAt = performance.now()
        startTime.current = startedAt
        penaltyMs.current = 0
        elapsedMs.value = durationMs ?? 0
        onBegin?.(startedAt)
        stage.value = 'running'
      },
      timers.current,
      countdownStepMs
    )
  }

  function addPenalty(ms: number): void {
    penaltyMs.current += ms
  }

  function currentElapsed(): number {
    return elapsedWithPenalty(startTime.current, penaltyMs.current)
  }

  return {
    stage,
    count,
    elapsedMs,
    startTime,
    penaltyMs,
    later,
    clearScheduled,
    reset,
    start,
    setStage,
    addPenalty,
    currentElapsed
  }
}
