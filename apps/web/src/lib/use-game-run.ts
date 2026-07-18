import { signal, useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { GameMode, RunChallenge, StartedRun } from '@elixir-drop/contracts'
import { applyRunProgress, requiredSessionToken, signOut } from './account'
import { ApiError, completeRun, startRun } from './api'
import { gamePathForRoute, loginRouteForGame } from './game-routes'
import { navigate } from './router'
import { TROPHY_ROAD_UPDATED_EVENT } from './trophy-road'

type RecordingNotice =
  | { state: 'idle' }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string; detail: string; actionLabel: string; action: () => void }

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

  const prepare = useCallback(async (): Promise<void> => {
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
  }, [challenge, mode, preparing, startError])

  useEffect(() => {
    void prepare()
  }, [prepare])

  async function submitCompletion(
    active: StartedRun,
    transcript: Record<string, unknown>,
    onRecorded?: () => void
  ): Promise<void> {
    setRecordingNotice({ state: 'saving', message: 'Recording your game…' })
    try {
      const result = await completeRun(active.runToken, transcript, requiredSessionToken())
      if (!result.accepted) {
        run.current = null
        pendingCompletion.current = null
        setRecordingNotice({
          state: 'error',
          message: 'This result is awaiting a quick integrity review.',
          detail: 'It was not added to your progress or the leaderboard. You can close this message and keep playing.',
          actionLabel: 'Close',
          action: () => setRecordingNotice({ state: 'idle' })
        })
        return
      }
      applyRunProgress(result)
      run.current = null
      pendingCompletion.current = null
      setRecordingNotice({ state: 'saved', message: 'Game recorded' })
      window.dispatchEvent(new Event(TROPHY_ROAD_UPDATED_EVENT))
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
      if (error instanceof ApiError && [400, 403, 404, 410].includes(error.status)) {
        pendingCompletion.current = null
        run.current = null
        console.warn('Online run completion could not be verified', {
          mode,
          code: error.code
        })
        setRecordingNotice({
          state: 'error',
          message: 'This game could not be verified and was not recorded.',
          detail:
            'Your result is still visible, but this run cannot be retried. Close this message, then start a new game.',
          actionLabel: 'Close',
          action: () => setRecordingNotice({ state: 'idle' })
        })
        return
      }
      console.warn('Online run completion was rejected', {
        mode,
        error: error instanceof Error ? error.message : 'unknown'
      })
      setRecordingNotice({
        state: 'error',
        message: 'This game has not been recorded yet. Keep this page open and try again.',
        detail: 'Your score and progress will stay here while Drop reconnects.',
        actionLabel: 'Retry recording',
        action: () => {
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
        detail: 'Your result is still visible, but it cannot be recorded without a signed run.',
        actionLabel: 'Try again',
        action: () => void prepare()
      })
      return
    }
    pendingCompletion.current = { run: active, transcript, onRecorded }
    await submitCompletion(active, transcript, onRecorded)
  }

  return { challenge, preparing, startError, prepare, complete }
}
