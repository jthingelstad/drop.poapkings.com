import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { GameMode, RunChallenge, StartedRun } from '@elixir-drop/contracts'
import { applyRunProgress, sessionToken } from './account'
import { ApiError, completeRun, startRun } from './api'

export function useGameRun<T extends GameMode>(mode: T) {
  const run = useRef<StartedRun | null>(null)
  const challenge = useSignal<Extract<RunChallenge, { mode: T }> | null>(null)
  const preparing = useSignal(true)

  async function prepare(): Promise<void> {
    preparing.value = true
    run.current = null
    challenge.value = null
    try {
      const started = await startRun(mode, sessionToken())
      run.current = started
      challenge.value = started.challenge as Extract<RunChallenge, { mode: T }>
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'api_unavailable')) {
        console.warn('Online run preparation failed; local play remains available', {
          mode,
          error: error instanceof Error ? error.name : 'unknown'
        })
      }
    } finally {
      preparing.value = false
    }
  }

  useEffect(() => {
    void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  async function complete(transcript: Record<string, unknown>): Promise<void> {
    const active = run.current
    run.current = null
    if (!active) return
    try {
      const result = await completeRun(active.runToken, transcript, sessionToken())
      applyRunProgress(result)
    } catch (error) {
      console.warn('Online run completion was rejected', {
        mode,
        error: error instanceof Error ? error.message : 'unknown'
      })
    }
  }

  return { challenge, preparing, prepare, complete }
}
