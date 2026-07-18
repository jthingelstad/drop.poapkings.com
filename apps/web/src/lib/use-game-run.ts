import { signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { GameMode, RunChallenge, StartedRun } from '@elixir-drop/contracts'
import { applyRunProgress, requiredSessionToken, signOut } from './account'
import { ApiError, completeRun, startRun } from './api'
import { gamePathForRoute, loginRouteForGame } from './game-routes'
import { navigate } from './router'

type RecordingNotice =
  | { state: 'idle' }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string; retry: () => void }

export const recordingNotice = signal<RecordingNotice>({ state: 'idle' })

let noticeTimer: number | undefined

function setRecordingNotice(notice: RecordingNotice): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
  recordingNotice.value = notice
  if (notice.state === 'saved') {
    noticeTimer = window.setTimeout(() => {
      recordingNotice.value = { state: 'idle' }
      noticeTimer = undefined
    }, 2_000)
  }
}

export function useGameRun<T extends GameMode>(mode: T) {
  const run = useRef<StartedRun | null>(null)
  const pendingCompletion = useRef<{
    run: StartedRun
    transcript: Record<string, unknown>
    onRecorded?: () => void
  } | null>(null)
  const challenge = useSignal<Extract<RunChallenge, { mode: T }> | null>(null)
  const preparing = useSignal(true)
  const startError = useSignal('')

  async function prepare(): Promise<void> {
    preparing.value = true
    run.current = null
    challenge.value = null
    startError.value = ''
    setRecordingNotice({ state: 'idle' })
    try {
      const started = await startRun(mode, requiredSessionToken())
      run.current = started
      challenge.value = started.challenge as Extract<RunChallenge, { mode: T }>
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut()
        const gamePath = gamePathForRoute(`/${mode}`)
        navigate(gamePath ? loginRouteForGame(gamePath) : '/login')
        return
      }
      startError.value =
        error instanceof Error ? error.message : 'Drop could not prepare a recorded game. Please try again.'
      console.warn('Recorded run preparation failed', {
        mode,
        error: error instanceof Error ? error.name : 'unknown'
      })
    } finally {
      preparing.value = false
    }
  }

  useEffect(() => {
    void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  async function submitCompletion(
    active: StartedRun,
    transcript: Record<string, unknown>,
    onRecorded?: () => void
  ): Promise<void> {
    setRecordingNotice({ state: 'saving', message: 'Recording your game…' })
    try {
      const result = await completeRun(active.runToken, transcript, requiredSessionToken())
      applyRunProgress(result)
      run.current = null
      pendingCompletion.current = null
      setRecordingNotice({ state: 'saved', message: 'Game recorded' })
      onRecorded?.()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        pendingCompletion.current = null
        setRecordingNotice({ state: 'idle' })
        signOut()
        const gamePath = gamePathForRoute(`/${mode}`)
        navigate(gamePath ? loginRouteForGame(gamePath) : '/login')
        return
      }
      console.warn('Online run completion was rejected', {
        mode,
        error: error instanceof Error ? error.message : 'unknown'
      })
      setRecordingNotice({
        state: 'error',
        message: 'This game has not been recorded yet. Keep this page open and try again.',
        retry: () => {
          const pending = pendingCompletion.current
          if (pending) void submitCompletion(pending.run, pending.transcript, pending.onRecorded)
        }
      })
    }
  }

  async function complete(transcript: Record<string, unknown>, onRecorded?: () => void): Promise<void> {
    const active = run.current
    if (!active) {
      setRecordingNotice({
        state: 'error',
        message: 'This game did not receive a signed run. Return to the game and try again.',
        retry: () => void prepare()
      })
      return
    }
    pendingCompletion.current = { run: active, transcript, onRecorded }
    await submitCompletion(active, transcript, onRecorded)
  }

  return { challenge, preparing, startError, prepare, complete }
}
