import { signal, useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { runReference, type GameMode, type RunChallenge, type StartedRun, type XpAward } from '@elixir-drop/contracts'
import { applyBadgeSummary, applyRunProgress, recordRecentRun, sessionToken, signOut } from './account'
import { ApiError, completeRun, reportRunFailure, startRun, type RunFailureReportInput } from './api'
import { buildMeta } from './build'
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
  | {
      state: 'error'
      message: string
      detail: string
      actionLabel: string
      action: () => void
      report?: FailureReportControl
    }

export interface FailureReportControl {
  runId: string
  state: 'sending' | 'ready' | 'failed' | 'saving-context' | 'context-saved' | 'context-failed'
  retry: () => void
  submitContext: (context: string) => Promise<boolean>
}

export const recordingNotice = signal<RecordingNotice>({ state: 'idle' })

// The server run id of the last RECORDED run — the only thing that can be
// shared, because a permalink needs a server record to point at. Offline,
// guest, and practice runs never set it, which is what makes the summary's
// share control absent rather than disabled: a disabled button invites a tap
// and then has to explain itself.
export const recordedRunId = signal<string | null>(null)
export const recordedRunCompletedAt = signal<string | null>(null)

// Rungs the last completed run cleared. Read straight from here by Summary,
// because six modes render that component and none of them know anything about
// badges. Cleared when the next run is prepared, so a replay never
// re-celebrates the previous run's badges.
//
// There is deliberately no "held for review" signal beside these. A run that
// just ended is ALWAYS awaiting a referee, so the summary says nothing about it;
// the recording toast names the hold and carries the reference, and the run log,
// the boards and Updates carry the verdict once there is one to carry.
export const earnedBadges = signal<EarnedRung[]>([])

// XP earned by the run just completed, for the summary's "what changed" ledger.
// Cleared on the next run for the same reason earnedBadges is.
export const earnedXp = signal(0)
export const earnedXpAwards = signal<XpAward[]>([])

// A local run is deliberately unrecorded, even if connectivity returns before
// it ends. Shared game chrome and summaries read this so the boundary is visible
// before, during, and after play instead of being discovered in history later.
export const offlineRunMode = signal<GameMode | null>(null)

export interface GameRunOptions {
  initialRun?: StartedRun | null
  onRunPrepared?: (run: StartedRun) => void
}

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

function reportClientMetadata() {
  const visibility: 'hidden' | 'visible' = document.visibilityState === 'hidden' ? 'hidden' : 'visible'
  return {
    buildId: buildMeta.id,
    online: navigator.onLine,
    visibility,
    displayMode:
      typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
        ? ('standalone' as const)
        : ('browser' as const)
  }
}

function failureReportInput(active: StartedRun, error: unknown): RunFailureReportInput {
  return {
    runId: active.runId,
    runToken: active.runToken,
    failure: {
      code: error instanceof ApiError ? error.code : 'unknown_failure',
      status: error instanceof ApiError ? error.status : 0
    },
    client: reportClientMetadata()
  }
}

function failureReportControl(active: StartedRun, error: unknown): FailureReportControl {
  const report = failureReportInput(active, error)

  const update = (state: FailureReportControl['state']) => {
    const current = recordingNotice.value
    if (current.state !== 'error' || current.report?.runId !== active.runId) return
    recordingNotice.value = { ...current, report: { ...current.report, state } }
  }

  const send = async (context?: string): Promise<boolean> => {
    update(context ? 'saving-context' : 'sending')
    try {
      await reportRunFailure(
        {
          ...report,
          ...(context ? { context } : {})
        },
        sessionToken()
      )
      update(context ? 'context-saved' : 'ready')
      return true
    } catch (reportError) {
      console.warn('Run error report could not be submitted', {
        mode: active.mode,
        runId: active.runId,
        error: reportError instanceof Error ? reportError.name : 'unknown'
      })
      update(context ? 'context-failed' : 'failed')
      return false
    }
  }

  return {
    runId: active.runId,
    state: 'sending',
    retry: () => void send(),
    submitContext: (context: string) => send(context)
  }
}

// A retryable completion failure is still an operational failure worth seeing.
// Keep its report out of the blocking UI, but retain one reporter beside the
// Retry action: an immediate attempt captures a live 5xx, while a failed
// network report is replayed when the player retries after connectivity returns.
function retryableFailureReporter(active: StartedRun, error: unknown): () => void {
  const report = failureReportInput(active, error)
  let state: 'idle' | 'sending' | 'sent' | 'failed' = 'idle'
  return () => {
    if (state === 'sending' || state === 'sent') return
    state = 'sending'
    void reportRunFailure(report, sessionToken()).then(
      () => {
        state = 'sent'
      },
      (reportError: unknown) => {
        state = 'failed'
        console.warn('Retryable run error report could not be submitted', {
          mode: active.mode,
          error: reportError instanceof Error ? reportError.name : 'unknown'
        })
      }
    )
  }
}

// Re-prepare a signed run when the player starts a game this close to its
// server-side expiry (a Ready screen left open, a long break before Start).
const RUN_FRESHNESS_BUFFER_MS = 2 * 60_000

function recordSeasonBest(result: { mode: GameMode; score: number; season: { id: number } }): boolean {
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

export function useGameRun<T extends GameMode>(mode: T, options?: GameRunOptions) {
  const run = useRef<StartedRun | null>(null)
  const initialRun = useRef(options?.initialRun ?? null)
  const onRunPrepared = useRef(options?.onRunPrepared)
  onRunPrepared.current = options?.onRunPrepared
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
    recordedRunId.value = null
    recordedRunCompletedAt.value = null
    earnedBadges.value = []
    earnedXp.value = 0
    earnedXpAwards.value = []
    offlineRunMode.value = null
    setRecordingNotice({ state: 'idle' })
    const prepareLocal = () => {
      localAttempted = true
      const local = localOfflineRun(mode)
      run.current = local
      challenge.value = local.challenge as Extract<RunChallenge, { mode: T }>
      offlineRunMode.value = mode
      onRunPrepared.current?.(local)
      track('game.started', mode)
    }
    try {
      const resumable = initialRun.current
      initialRun.current = null
      if (resumable?.mode === mode && Date.parse(resumable.expiresAt) > Date.now()) {
        run.current = resumable
        challenge.value = resumable.challenge as Extract<RunChallenge, { mode: T }>
        if (isOfflineRun(resumable)) offlineRunMode.value = mode
        return
      }
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
      onRunPrepared.current?.(started)
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
      mode === 'practice'
        ? { state: active.guest ? 'scoring' : 'saving', message: 'Finishing your session…' }
        : active.guest
          ? { state: 'scoring', message: 'Scoring your game…' }
          : { state: 'saving', message: 'Recording your game…' }
    )
    let result: Awaited<ReturnType<typeof completeRun>>
    try {
      result = await completeRun(active.runToken, transcript, sessionToken())
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
      if (runExpired || (error instanceof ApiError && [400, 403, 404, 409].includes(error.status))) {
        pendingCompletion.current = null
        run.current = null
        console.warn('Online run completion could not be verified', {
          mode,
          runId: active.runId,
          code: error instanceof ApiError ? error.code : 'unknown'
        })
        const report = failureReportControl(active, error)
        setRecordingNotice(
          runExpired
            ? {
                state: 'error',
                message: 'This game ran past its signed time window and was not recorded.',
                detail: `You are still signed in and your local result is visible. Close this message, then start a new game. Reference: ${runReference(active.runId)}`,
                actionLabel: 'Close',
                action: () => setRecordingNotice({ state: 'idle' }),
                report
              }
            : {
                state: 'error',
                message: 'This game could not be verified and was not recorded.',
                detail: `Your result is still visible, but this run cannot be retried. Close this message, then start a new game. Reference: ${runReference(active.runId)}`,
                actionLabel: 'Close',
                action: () => setRecordingNotice({ state: 'idle' }),
                report
              }
        )
        report.retry()
        onUnrecorded?.()
        return
      }
      console.warn('Online run completion was rejected', {
        mode,
        error: error instanceof Error ? error.message : 'unknown'
      })
      const reportRetryableFailure = retryableFailureReporter(active, error)
      reportRetryableFailure()
      setRecordingNotice({
        state: 'error',
        message: 'This game has not been recorded yet. Keep this page open and try again.',
        detail: 'Your score and progress will stay here while Drop reconnects.',
        actionLabel: 'Retry recording',
        action: () => {
          reportRetryableFailure()
          const pending = pendingCompletion.current
          if (pending) void submitCompletion(pending.run, pending.transcript, pending.onRecorded, pending.onUnrecorded)
        }
      })
      return
    }

    // A guest run is scored but never recorded: there is no player progress to
    // apply and no account to refresh. Its local results remain browser-owned.
    if (result.guest) {
      let seasonBest = false
      let personalBest = false
      try {
        seasonBest = recordSeasonBest(result)
        personalBest = recordAllTimeBest(result)
        track('game.completed', result.mode)
        if (personalBest) track('game.personal_best', result.mode)
      } catch (error) {
        console.warn('Guest run result could not be fully applied', {
          mode,
          error: error instanceof Error ? error.name : 'unknown'
        })
      }
      run.current = null
      pendingCompletion.current = null
      setRecordingNotice({
        state: 'saved',
        message: !isRecordedMode(result.mode)
          ? 'Practice session complete'
          : seasonBest
            ? 'Local best! Sign in before your next game to record future scores'
            : 'Played as a guest — sign in before your next game to record scores'
      })
      try {
        onRecorded?.()
      } catch (error) {
        console.warn('Guest run follow-up failed', { mode, error: error instanceof Error ? error.name : 'unknown' })
      }
      return
    }

    // The response above is the durable server acknowledgement. Mark it saved
    // before applying any optional browser projections: local storage, badge
    // state, or a mode callback must never turn a recorded game back into a
    // retryable API failure.
    run.current = null
    pendingCompletion.current = null
    recordedRunId.value = isRecordedMode(result.mode) ? result.runId : null
    recordedRunCompletedAt.value = isRecordedMode(result.mode) ? result.completedAt : null
    earnedBadges.value = result.earnedBadges ?? []
    earnedXp.value = result.xpEarned ?? 0
    earnedXpAwards.value = result.xpAwards ?? []
    setRecordingNotice({
      state: 'saved',
      message: !isRecordedMode(result.mode)
        ? 'Practice session saved'
        : result.underReview
          ? 'Game recorded — awaiting the referee'
          : 'Game recorded',
      ...(result.underReview ? { detail: `Reference: ${runReference(result.runId)}` } : {})
    })

    try {
      const seasonBest = recordSeasonBest(result)
      recordAllTimeBest(result)
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
      if (seasonBest && isRecordedMode(result.mode) && !result.underReview) {
        setRecordingNotice({ state: 'saved', message: 'Game recorded — new season best!' })
      }
      window.dispatchEvent(new Event(TROPHY_ROAD_UPDATED_EVENT))
    } catch (error) {
      console.warn('Recorded run result could not be fully applied', {
        mode,
        error: error instanceof Error ? error.name : 'unknown'
      })
    }
    try {
      onRecorded?.()
    } catch (error) {
      console.warn('Recorded run follow-up failed', { mode, error: error instanceof Error ? error.name : 'unknown' })
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
