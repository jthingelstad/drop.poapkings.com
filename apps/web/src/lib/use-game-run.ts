import { signal, useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { GameMode, RunChallenge, StartedRun } from '@elixir-drop/contracts'
import { applyRunProgress, recordRecentRun, sessionToken, signOut } from './account'
import { ApiError, completeRun, startRun } from './api'
import { betterScore, LOWER_IS_BETTER, RECORD_KEYS } from './game-metadata'
import { getRecords, getSeasonRecords, saveRecords, saveSeasonRecord } from './storage'
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

// Re-prepare a signed run when the player starts a game this close to its
// server-side expiry (a Ready screen left open, a long break before Start).
const RUN_FRESHNESS_BUFFER_MS = 2 * 60_000

function recordSeasonBest(result: { mode: GameMode; score: number; season: { id: string } }): boolean {
  const key = RECORD_KEYS[result.mode]
  const current = getSeasonRecords(result.season.id)[key]
  const better =
    current === undefined || (LOWER_IS_BETTER.has(result.mode) ? result.score < current : result.score > current)
  if (better) saveSeasonRecord(result.season.id, { [key]: result.score })
  // The first recorded score of a season is a baseline, not a "best".
  return better && current !== undefined
}

// Persist the all-time local best ONLY for a server-accepted run, so a device
// can never keep a "best" the API rejected. localStorage records mirror the
// leaderboard: the previous divergence (each mode wrote its best eagerly in
// finish(), before the server verdict) is why a rejected run still showed as a
// personal best on that player's device.
function recordAllTimeBest(result: { mode: GameMode; score: number }): void {
  const key = RECORD_KEYS[result.mode]
  const current = getRecords()[key] as number | undefined
  if (betterScore(result.mode, result.score, current)) saveRecords({ [key]: result.score })
}

export function useGameRun<T extends GameMode>(mode: T) {
  const run = useRef<StartedRun | null>(null)
  const pendingCompletion = useRef<{
    run: StartedRun
    transcript: Record<string, unknown>
    onRecorded?: () => void
    onUnrecorded?: () => void
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
      // No token → a guest run: the server deals the same signed challenge but
      // records nothing on completion.
      const started = await startRun(mode, sessionToken())
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

  // Returns true when the held run is safe to start now. A stale or missing
  // run triggers a re-prepare and returns false: the fresh challenge still has
  // to preload, so the mode's Start button simply re-enables when it is ready.
  const ensureFreshRun = useCallback(async (): Promise<boolean> => {
    const active = run.current
    if (active) {
      const expiresAtMs = Date.parse(active.expiresAt)
      if (!Number.isFinite(expiresAtMs) || Date.now() < expiresAtMs - RUN_FRESHNESS_BUFFER_MS) return true
    }
    await prepare()
    return false
  }, [prepare])

  async function submitCompletion(
    active: StartedRun,
    transcript: Record<string, unknown>,
    onRecorded?: () => void,
    onUnrecorded?: () => void
  ): Promise<void> {
    setRecordingNotice({ state: 'saving', message: 'Recording your game…' })
    try {
      const result = await completeRun(active.runToken, transcript, sessionToken())
      // A guest run is scored but never recorded: there is no player progress
      // to apply and no account to refresh. The local bests still track (so a
      // signed-out streak advances and the device shows a personal best), and
      // the normal onRecorded fires so streak modes deal the next game.
      if (result.guest) {
        run.current = null
        pendingCompletion.current = null
        const seasonBest = recordSeasonBest(result)
        recordAllTimeBest(result)
        setRecordingNotice({
          state: 'saved',
          message: seasonBest ? 'Local best! Sign in to save it' : 'Played as a guest — sign in to save scores'
        })
        onRecorded?.()
        return
      }
      applyRunProgress(result)
      recordRecentRun({
        runId: result.runId,
        mode: result.mode,
        score: result.score,
        seasonId: result.season.id,
        completedAt: result.completedAt
      })
      run.current = null
      pendingCompletion.current = null
      const seasonBest = recordSeasonBest(result)
      recordAllTimeBest(result)
      // Practice is unranked by design; its local bests still track quietly,
      // but the toast stays plain practice language.
      setRecordingNotice({
        state: 'saved',
        message:
          result.ranked === false
            ? 'Practice recorded'
            : seasonBest
              ? 'Game recorded — new season best!'
              : 'Game recorded'
      })
      window.dispatchEvent(new Event(TROPHY_ROAD_UPDATED_EVENT))
      onRecorded?.()
    } catch (error) {
      // An expired or invalid run token only invalidates this run, never the
      // player's session — do not sign the player out over a stale game.
      const runTokenRejected = error instanceof ApiError && error.status === 401 && error.code === 'invalid_run_token'
      if (error instanceof ApiError && error.status === 401 && !runTokenRejected) {
        pendingCompletion.current = null
        setRecordingNotice({ state: 'idle' })
        signOut()
        const gamePath = gamePathForRoute(`/${mode}`)
        navigate(gamePath ? loginRouteForGame(gamePath) : '/login')
        return
      }
      const runExpired = runTokenRejected || (error instanceof ApiError && error.status === 410)
      if (runExpired || (error instanceof ApiError && [400, 403, 404].includes(error.status))) {
        pendingCompletion.current = null
        run.current = null
        console.warn('Online run completion could not be verified', {
          mode,
          runId: active.runId,
          code: error instanceof ApiError ? error.code : 'unknown'
        })
        setRecordingNotice(
          runExpired
            ? {
                state: 'error',
                message: 'This game ran past its signed time window and was not recorded.',
                detail: `You are still signed in and your local result is visible. Close this message, then start a new game. Reference: ${active.runId}`,
                actionLabel: 'Close',
                action: () => setRecordingNotice({ state: 'idle' })
              }
            : {
                state: 'error',
                message: 'This game could not be verified and was not recorded.',
                detail: `Your result is still visible, but this run cannot be retried. Close this message, then start a new game. Reference: ${active.runId}`,
                actionLabel: 'Close',
                action: () => setRecordingNotice({ state: 'idle' })
              }
        )
        onUnrecorded?.()
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
          if (pending) void submitCompletion(pending.run, pending.transcript, pending.onRecorded, pending.onUnrecorded)
        }
      })
    }
  }

  // onRecorded fires when the result is accepted; onUnrecorded fires when
  // this run is settled without being recorded (rejected or expired) so
  // streak-style modes can deal a fresh game instead of stranding the player
  // on disabled controls.
  async function complete(
    transcript: Record<string, unknown>,
    onRecorded?: () => void,
    onUnrecorded?: () => void
  ): Promise<void> {
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
    pendingCompletion.current = { run: active, transcript, onRecorded, onUnrecorded }
    await submitCompletion(active, transcript, onRecorded, onUnrecorded)
  }

  return { challenge, preparing, startError, prepare, ensureFreshRun, complete }
}
