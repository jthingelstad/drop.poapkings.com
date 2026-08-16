import { signal, useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { runReference, type GameMode, type RunChallenge, type StartedRun } from '@elixir-drop/contracts'
import { applyBadgeSummary, applyRunProgress, recordRecentRun, sessionToken, signOut } from './account'
import { ApiError, completeRun, startRun } from './api'
import { betterScore, isRecordedMode, LOWER_IS_BETTER, RECORD_KEYS } from './game-metadata'
import { getRecords, getSeasonRecords, saveRecords, saveSeasonRecord } from './storage'
import { gamePathForRoute, loginRouteForGame } from './game-routes'
import type { EarnedRung } from '../components/BadgeEarned'
import { isOfflineRun, localOfflineRun } from './offline-run'
import { navigate } from './router'
import { TROPHY_ROAD_UPDATED_EVENT } from './trophy-road'
import { track } from './analytics'
import { offline } from './api-availability'

type RecordingNotice =
  | { state: 'idle' }
  | { state: 'scoring'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string; detail?: string }
  | { state: 'error'; message: string; detail: string; actionLabel: string; action: () => void }

export const recordingNotice = signal<RecordingNotice>({ state: 'idle' })

// The last completed run was recorded but held off the public board pending a
// Fair Play Referee decision. This is deliberately NOT part of `recordingNotice`:
// that toast clears itself after two seconds, and "your score is not on the
// board" is the one thing a player must still be able to read once they stop and
// look at their summary. Cleared when the next run is prepared.
export const heldForReview = signal(false)
// The server-issued run UUID is the join between the immediate recording
// notice, owner history, retained evidence, and the referee decision.
export const heldForReviewReference = signal<string | null>(null)

// Rungs the last completed run cleared. Read straight from here by Summary, for
// the same reason heldForReview is: six modes render that component and none of
// them know anything about badges. Cleared when the next run is prepared, so a
// replay never re-celebrates the previous run's badges.
export const earnedBadges = signal<EarnedRung[]>([])

// A local run is deliberately unrecorded, even if connectivity returns before
// it ends. Shared game chrome and summaries read this so the boundary is visible
// before, during, and after play instead of being discovered in history later.
export const offlineRunMode = signal<GameMode | null>(null)

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
  // Practice keeps no record of any kind — not seasonal, not all-time.
  if (!isRecordedMode(result.mode)) return false
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
function recordAllTimeBest(result: { mode: GameMode; score: number }): boolean {
  if (!isRecordedMode(result.mode)) return false
  const key = RECORD_KEYS[result.mode]
  const current = getRecords()[key] as number | undefined
  const better = betterScore(result.mode, result.score, current)
  if (better) saveRecords({ [key]: result.score })
  return better
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
    let localAttempted = false
    preparing.value = true
    run.current = null
    challenge.value = null
    startError.value = ''
    heldForReview.value = false
    heldForReviewReference.value = null
    earnedBadges.value = []
    offlineRunMode.value = null
    setRecordingNotice({ state: 'idle' })
    const prepareLocal = () => {
      localAttempted = true
      const local = localOfflineRun(mode)
      run.current = local
      challenge.value = local.challenge as Extract<RunChallenge, { mode: T }>
      offlineRunMode.value = mode
      track('game.started', mode)
    }
    try {
      // A known transport or API outage means there is nowhere safe to create
      // an official attempt. Deal locally without spending another timeout.
      if (offline.value) {
        prepareLocal()
        return
      }
      // No token → a guest run: the server deals the same signed challenge but
      // records nothing on completion.
      const started = await startRun(mode, sessionToken())
      run.current = started
      challenge.value = started.challenge as Extract<RunChallenge, { mode: T }>
      track('game.started', mode)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut()
        const gamePath = gamePathForRoute(`/${mode}`)
        navigate(gamePath ? loginRouteForGame(gamePath) : '/login')
        return
      }
      // The failed request may be what changed effective availability. Every
      // mode can continue locally, and the run is visibly unrecorded from here.
      if (!localAttempted && offline.value) {
        prepareLocal()
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
    // A locally dealt session has no server run to complete. Nothing is sent or
    // queued, and reconnecting cannot promote it into an official result.
    if (isOfflineRun(active)) {
      run.current = null
      pendingCompletion.current = null
      setRecordingNotice({ state: 'saved', message: 'Offline run complete — not saved' })
      onUnrecorded?.()
      return
    }
    setRecordingNotice(
      active.guest
        ? { state: 'scoring', message: 'Scoring your game…' }
        : { state: 'saving', message: 'Recording your game…' }
    )
    try {
      const result = await completeRun(active.runToken, transcript, sessionToken())
      const seasonBest = recordSeasonBest(result)
      const personalBest = recordAllTimeBest(result)
      track('game.completed', result.mode)
      if (personalBest) track('game.personal_best', result.mode)
      // A guest run is scored but never recorded: there is no player progress
      // to apply and no account to refresh. The local bests still track (so a
      // signed-out streak advances and the device shows a personal best), and
      // the normal onRecorded fires so streak modes deal the next game.
      if (result.guest) {
        run.current = null
        pendingCompletion.current = null
        setRecordingNotice({
          state: 'saved',
          message: !isRecordedMode(result.mode)
            ? 'Practice session complete'
            : seasonBest
              ? 'Local best! Sign in to save it'
              : 'Played as a guest — sign in to save scores'
        })
        onRecorded?.()
        return
      }
      applyRunProgress(result)
      if (result.badges) applyBadgeSummary(result.badges)
      recordRecentRun({
        runId: result.runId,
        mode: result.mode,
        score: result.score,
        seasonId: result.season.id,
        completedAt: result.completedAt,
        ...(result.underReview ? { reviewStatus: 'pending' } : {})
      })
      run.current = null
      pendingCompletion.current = null
      // Practice keeps no record and earns no XP; the run exists server-side
      // only so the validated transcript can feed the learning stats. Its toast
      // says exactly that and never mentions a score or a best.
      // A held run really did record — it scored, it kept its XP, and it counts
      // toward the player's totals. Only its place on the public board is
      // pending, so the toast says recorded and names the hold rather than
      // celebrating a season best the board is not showing anyone.
      heldForReview.value = result.underReview === true
      heldForReviewReference.value = result.underReview ? runReference(result.runId) : null
      earnedBadges.value = result.earnedBadges ?? []
      setRecordingNotice({
        state: 'saved',
        message: !isRecordedMode(result.mode)
          ? 'Practice session saved'
          : result.underReview
            ? 'Game recorded — awaiting the referee'
            : seasonBest
              ? 'Game recorded — new season best!'
              : 'Game recorded',
        ...(result.underReview ? { detail: `Reference: ${runReference(result.runId)}` } : {})
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
                detail: `You are still signed in and your local result is visible. Close this message, then start a new game. Reference: ${runReference(active.runId)}`,
                actionLabel: 'Close',
                action: () => setRecordingNotice({ state: 'idle' })
              }
            : {
                state: 'error',
                message: 'This game could not be verified and was not recorded.',
                detail: `Your result is still visible, but this run cannot be retried. Close this message, then start a new game. Reference: ${runReference(active.runId)}`,
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

  return {
    challenge,
    preparing,
    startError,
    prepare,
    ensureFreshRun,
    complete,
    offline: offlineRunMode.value === mode
  }
}
