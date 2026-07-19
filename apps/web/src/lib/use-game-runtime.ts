import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { clearTimers, elapsedWithPenalty, schedule, startCountdown, type TimerList } from './run-loop'
import {
  createGameRuntimeCue,
  transitionGameRuntimeStage,
  type GameRuntimeCue,
  type GameRuntimeCueType,
  type GameRuntimeStage
} from './game-runtime'
import { useRunUnloadGuard } from './use-run-unload-guard'

interface GameRuntimeOptions {
  countdownStepMs?: number
  durationMs?: number
  onDurationEnd?: () => void
  initialStage?: GameRuntimeStage
  guardActiveRun?: boolean
  trackElapsed?: boolean
}

export function useGameRuntime({
  countdownStepMs,
  durationMs,
  onDurationEnd,
  initialStage = 'ready',
  guardActiveRun = true,
  trackElapsed = true
}: GameRuntimeOptions = {}) {
  const stage = useSignal<GameRuntimeStage>(initialStage)
  const count = useSignal(3)
  const elapsedMs = useSignal(durationMs ?? 0)
  const penaltyPulse = useSignal(0)
  const cue = useSignal<GameRuntimeCue | null>(null)
  const startTime = useRef(0)
  const penaltyMs = useRef(0)
  const timers = useRef<TimerList>([])
  const cueId = useRef(0)
  const onDurationEndRef = useRef(onDurationEnd)
  onDurationEndRef.current = onDurationEnd

  useEffect(() => {
    const timerList = timers.current
    return () => clearTimers(timerList)
  }, [])

  useRunUnloadGuard(guardActiveRun && stage.value === 'running')

  useEffect(() => {
    if (!trackElapsed || stage.value !== 'running') return
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
  }, [durationMs, elapsedMs, stage.value, trackElapsed])

  function emitCue<TDetail>(type: GameRuntimeCueType, detail?: TDetail): GameRuntimeCue<TDetail> {
    const next = createGameRuntimeCue(++cueId.current, type, performance.now(), detail)
    cue.value = next
    return next
  }

  function later(fn: () => void, ms: number): void {
    schedule(timers.current, fn, ms)
  }

  function clearScheduled(): void {
    clearTimers(timers.current)
  }

  function setStage(next: GameRuntimeStage): void {
    stage.value = transitionGameRuntimeStage(stage.value, next)
  }

  function begin(onBegin?: (startedAt: number) => void): void {
    const startedAt = performance.now()
    startTime.current = startedAt
    penaltyMs.current = 0
    elapsedMs.value = durationMs ?? 0
    onBegin?.(startedAt)
    setStage('running')
    emitCue('run-start')
  }

  function start(onBegin?: (startedAt: number) => void): void {
    if (countdownStepMs === undefined) {
      begin(onBegin)
      return
    }
    setStage('countdown')
    emitCue('run-countdown', { count: count.value })
    startCountdown(count, () => begin(onBegin), timers.current, countdownStepMs)
  }

  function startNow(onBegin?: (startedAt: number) => void): void {
    begin(onBegin)
  }

  function finish(next: 'summary' | 'over' = 'summary'): void {
    setStage(next)
    emitCue('run-complete', { stage: next })
  }

  function reset(nextStage: GameRuntimeStage = 'ready'): void {
    clearScheduled()
    startTime.current = 0
    penaltyMs.current = 0
    count.value = 3
    elapsedMs.value = durationMs ?? 0
    stage.value = nextStage
    cue.value = null
    emitCue('restart', { stage: nextStage })
  }

  function addPenalty(ms: number): void {
    penaltyMs.current += ms
    penaltyPulse.value += 1
    emitCue('penalty', { ms })
  }

  function currentElapsed(): number {
    return elapsedWithPenalty(startTime.current, penaltyMs.current)
  }

  return {
    stage,
    count,
    elapsedMs,
    penaltyPulse,
    cue,
    startTime,
    penaltyMs,
    emitCue,
    later,
    clearScheduled,
    reset,
    start,
    startNow,
    finish,
    setStage,
    addPenalty,
    currentElapsed
  }
}
