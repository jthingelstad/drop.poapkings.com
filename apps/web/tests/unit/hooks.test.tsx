import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'

// --- Collaborator mocks (nothing hits the network) ---------------------------
vi.mock('../../src/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    startRun: vi.fn(),
    completeRun: vi.fn()
  }
})

vi.mock('../../src/lib/account', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/account')>()
  return {
    ...actual,
    sessionToken: vi.fn(() => 'session-token'),
    signOut: vi.fn(),
    applyRunProgress: vi.fn(),
    recordRecentRun: vi.fn()
  }
})

vi.mock('../../src/lib/preload', () => ({
  preloadImages: vi.fn((cards: unknown[], done: (n: number) => void) => {
    done(Array.isArray(cards) ? cards.length : 0)
  })
}))

vi.mock('../../src/lib/analytics', () => ({
  track: vi.fn()
}))

import { ApiError, startRun, completeRun } from '../../src/lib/api'
import { signOut, applyRunProgress, recordRecentRun } from '../../src/lib/account'
import { preloadImages } from '../../src/lib/preload'
import { track } from '../../src/lib/analytics'
import { useGameRuntime } from '../../src/lib/use-game-runtime'
import { useGameRun, recordingNotice } from '../../src/lib/use-game-run'
import { useGameSession } from '../../src/lib/use-game-session'
import { useRunUnloadGuard } from '../../src/lib/use-run-unload-guard'
import { schedule, clearTimers, startCountdown, elapsedWithPenalty } from '../../src/lib/run-loop'
import { transitionGameRuntimeStage, createGameRuntimeCue } from '../../src/lib/game-runtime'

// --- Tiny render harness ------------------------------------------------------
const hosts: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host)
    host.remove()
  }
  vi.useRealTimers()
})

beforeEach(() => {
  recordingNotice.value = { state: 'idle' }
})

// =============================================================================
// run-loop.ts (pure-ish helpers)
// =============================================================================
describe('run-loop helpers', () => {
  it('schedule + clearTimers queue and cancel timeouts', () => {
    vi.useFakeTimers()
    const timers: number[] = []
    const fn = vi.fn()
    schedule(timers, fn, 100)
    expect(timers).toHaveLength(1)
    clearTimers(timers)
    expect(timers).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })

  it('schedule fires the callback after its delay', () => {
    vi.useFakeTimers()
    const timers: number[] = []
    const fn = vi.fn()
    schedule(timers, fn, 50)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('startCountdown steps 3 -> 2 -> 1 then begins', () => {
    vi.useFakeTimers()
    const timers: number[] = []
    const count = { value: 0 }
    const begin = vi.fn()
    startCountdown(count, begin, timers, 100)
    expect(count.value).toBe(3)
    vi.advanceTimersByTime(100)
    expect(count.value).toBe(2)
    vi.advanceTimersByTime(100)
    expect(count.value).toBe(1)
    expect(begin).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(count.value).toBe(1)
  })

  it('elapsedWithPenalty measures monotonic time plus penalty', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_500)
    expect(elapsedWithPenalty(1_000)).toBe(500)
    expect(elapsedWithPenalty(1_000, 250)).toBe(750)
  })
})

// =============================================================================
// game-runtime.ts (stage machine + cue factory)
// =============================================================================
describe('game-runtime pure helpers', () => {
  it('allows valid transitions and is a no-op for same stage', () => {
    expect(transitionGameRuntimeStage('ready', 'countdown')).toBe('countdown')
    expect(transitionGameRuntimeStage('countdown', 'running')).toBe('running')
    expect(transitionGameRuntimeStage('running', 'summary')).toBe('summary')
    expect(transitionGameRuntimeStage('running', 'running')).toBe('running')
  })

  it('throws on an illegal transition', () => {
    expect(() => transitionGameRuntimeStage('ready', 'summary')).toThrow(/Invalid game runtime transition/)
    expect(() => transitionGameRuntimeStage('summary', 'over')).toThrow()
  })

  it('creates cues, omitting an undefined detail', () => {
    const bare = createGameRuntimeCue(1, 'run-start', 10)
    expect(bare).toEqual({ id: 1, type: 'run-start', atMs: 10 })
    expect('detail' in bare).toBe(false)
    const withDetail = createGameRuntimeCue(2, 'penalty', 20, { ms: 2_000 })
    expect(withDetail).toEqual({ id: 2, type: 'penalty', atMs: 20, detail: { ms: 2_000 } })
  })
})

// =============================================================================
// use-run-unload-guard.ts
// =============================================================================
describe('useRunUnloadGuard', () => {
  it('does not register a listener while inactive', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const active = false
    function Probe() {
      useRunUnloadGuard(active)
      return null
    }
    const host = makeHost()
    void act(() => render(<Probe />, host))
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0)
  })

  it('adds a beforeunload listener when active and removes it when it deactivates', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    let active = true
    function Probe() {
      useRunUnloadGuard(active)
      return null
    }
    const host = makeHost()
    void act(() => render(<Probe />, host))
    const added = add.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(added).toHaveLength(1)
    const guard = added[0]![1]

    active = false
    void act(() => render(<Probe />, host))
    const removed = remove.mock.calls.filter(([type]) => type === 'beforeunload')
    expect(removed).toHaveLength(1)
    // The exact listener registered is the one torn down.
    expect(removed[0]![1]).toBe(guard)
  })

  it('the guard calls preventDefault on the unload event', () => {
    const add = vi.spyOn(window, 'addEventListener')
    function Probe() {
      useRunUnloadGuard(true)
      return null
    }
    const host = makeHost()
    void act(() => render(<Probe />, host))
    const guard = add.mock.calls.find(([type]) => type === 'beforeunload')![1] as (e: Event) => void
    const preventDefault = vi.fn()
    const event = { preventDefault } as unknown as BeforeUnloadEvent
    guard(event)
    expect(preventDefault).toHaveBeenCalled()
  })
})

// =============================================================================
// use-game-runtime.ts
// =============================================================================
type RuntimeApi = ReturnType<typeof useGameRuntime>

function mountRuntime(opts: Parameters<typeof useGameRuntime>[0] = {}): { api: () => RuntimeApi } {
  let current: RuntimeApi
  function Probe() {
    current = useGameRuntime(opts)
    return null
  }
  const host = makeHost()
  void act(() => render(<Probe />, host))
  return { api: () => current }
}

describe('useGameRuntime', () => {
  it('initializes stage/count/elapsed and mounts without throwing', () => {
    const { api } = mountRuntime({ durationMs: 5_000, guardActiveRun: false, trackElapsed: false })
    expect(api().stage.value).toBe('ready')
    expect(api().count.value).toBe(3)
    expect(api().elapsedMs.value).toBe(5_000)
    expect(api().cue.value).toBeNull()
  })

  it('start() with no countdown begins immediately', () => {
    const onBegin = vi.fn()
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    void act(() => api().start(onBegin))
    expect(api().stage.value).toBe('running')
    expect(onBegin).toHaveBeenCalledTimes(1)
    expect(api().cue.value?.type).toBe('run-start')
  })

  it('start() runs a 3-2-1 countdown then transitions ready -> countdown -> running', () => {
    vi.useFakeTimers()
    const onBegin = vi.fn()
    const { api } = mountRuntime({ countdownStepMs: 100, guardActiveRun: false, trackElapsed: false })

    void act(() => api().start(onBegin))
    expect(api().stage.value).toBe('countdown')
    expect(api().cue.value?.type).toBe('run-countdown')
    expect(api().count.value).toBe(3)

    void act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(api().count.value).toBe(2)
    void act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(api().count.value).toBe(1)
    expect(api().stage.value).toBe('countdown')

    void act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(api().stage.value).toBe('running')
    expect(onBegin).toHaveBeenCalledTimes(1)
    expect(api().cue.value?.type).toBe('run-start')
  })

  it('finish() moves to summary and reset() returns to ready with a restart cue', () => {
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    void act(() => api().startNow())
    expect(api().stage.value).toBe('running')

    void act(() => api().finish())
    expect(api().stage.value).toBe('summary')
    expect(api().cue.value?.type).toBe('run-complete')
    const finishDetail = api().cue.value?.detail as { stage: string } | undefined
    expect(finishDetail?.stage).toBe('summary')

    void act(() => api().reset())
    expect(api().stage.value).toBe('ready')
    expect(api().count.value).toBe(3)
    expect(api().cue.value?.type).toBe('restart')
  })

  it('finish("over") is allowed straight from running', () => {
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    void act(() => api().startNow())
    void act(() => api().finish('over'))
    expect(api().stage.value).toBe('over')
  })

  it('addPenalty pulses, accrues penalty time, and emits a penalty cue', () => {
    let clock = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    void act(() => api().startNow())
    clock = 1_400 // 400ms of wall time elapsed since start

    void act(() => api().addPenalty(2_000))
    expect(api().penaltyPulse.value).toBe(1)
    expect(api().penaltyMs.current).toBe(2_000)
    expect(api().cue.value?.type).toBe('penalty')
    // currentElapsed = (now - startTime) + penalty = 400 + 2000
    expect(api().currentElapsed()).toBe(2_400)
  })

  it('emitCue increments cue ids monotonically', () => {
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    let first!: number
    let second!: number
    void act(() => {
      first = api().emitCue('answer-correct').id
      second = api().emitCue('answer-wrong').id
    })
    expect(second).toBe(first + 1)
    expect(api().cue.value?.type).toBe('answer-wrong')
  })

  it('later() schedules work on the internal timer list', () => {
    vi.useFakeTimers()
    const { api } = mountRuntime({ guardActiveRun: false, trackElapsed: false })
    const fn = vi.fn()
    void act(() => api().later(fn, 500))
    void act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('tracks countdown-to-zero elapsed and fires onDurationEnd', () => {
    let clock = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    let rafCb: (() => void) | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const onDurationEnd = vi.fn()
    const { api } = mountRuntime({ durationMs: 5_000, onDurationEnd, guardActiveRun: false })
    void act(() => api().startNow())
    expect(api().stage.value).toBe('running')
    expect(typeof rafCb).toBe('function')

    // Partway through the run: time remaining shrinks.
    clock = 1_200
    void act(() => rafCb!())
    expect(api().elapsedMs.value).toBe(4_800)

    // Past the duration: elapsed clamps to zero and the end callback fires.
    clock = 7_000
    void act(() => rafCb!())
    expect(api().elapsedMs.value).toBe(0)
    expect(onDurationEnd).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})

// =============================================================================
// use-game-run.ts (mocked api + account + storage-backed localStorage)
// =============================================================================
const freshExpiry = () => new Date(Date.now() + 60 * 60_000).toISOString()

function startedRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    runToken: 'token-1',
    mode: 'surge',
    challenge: { mode: 'surge', cardIds: [1, 2, 3] },
    expiresAt: freshExpiry(),
    ...overrides
  }
}

type RunApi = ReturnType<typeof useGameRun>

function mountRun(mode: 'surge' = 'surge'): { api: () => RunApi } {
  let current: RunApi
  function Probe() {
    current = useGameRun(mode)
    return null
  }
  const host = makeHost()
  void act(() => render(<Probe />, host))
  return { api: () => current }
}

describe('useGameRun', () => {
  beforeEach(() => {
    vi.mocked(startRun).mockReset()
    vi.mocked(completeRun).mockReset()
    vi.mocked(signOut).mockClear()
    vi.mocked(applyRunProgress).mockClear()
    vi.mocked(recordRecentRun).mockClear()
    vi.mocked(track).mockClear()
    localStorage.removeItem('elixirdrop:records')
    localStorage.removeItem('elixirdrop:seasonRecords')
  })

  it('prepares a signed run on mount', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    const { api } = mountRun()
    await flush()
    expect(startRun).toHaveBeenCalledWith('surge', 'session-token')
    expect(api().preparing.value).toBe(false)
    expect(api().startError.value).toBe('')
    expect(api().challenge.value).toEqual({ mode: 'surge', cardIds: [1, 2, 3] })
    expect(track).toHaveBeenCalledWith('game.started', 'surge')
  })

  it('a 401 on prepare signs the player out and clears the challenge', async () => {
    vi.mocked(startRun).mockRejectedValue(new ApiError(401, 'unauthorized', 'nope'))
    const { api } = mountRun()
    await flush()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(api().challenge.value).toBeNull()
    expect(api().preparing.value).toBe(false)
  })

  it('a non-auth failure surfaces a start error message', async () => {
    vi.mocked(startRun).mockRejectedValue(new Error('boom'))
    const { api } = mountRun()
    await flush()
    expect(api().startError.value).toBe('boom')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('ensureFreshRun returns true for a run comfortably before expiry', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    const { api } = mountRun()
    await flush()
    let fresh: boolean | undefined
    await act(async () => {
      fresh = await api().ensureFreshRun()
    })
    expect(fresh).toBe(true)
    expect(startRun).toHaveBeenCalledTimes(1)
  })

  it('ensureFreshRun re-prepares (returns false) when the run is near expiry', async () => {
    vi.mocked(startRun).mockResolvedValue(
      startedRun({ expiresAt: new Date(Date.now() + 1_000).toISOString() }) as never
    )
    const { api } = mountRun()
    await flush()
    let fresh: boolean | undefined
    await act(async () => {
      fresh = await api().ensureFreshRun()
    })
    expect(fresh).toBe(false)
    expect(startRun).toHaveBeenCalledTimes(2)
  })

  it('complete() on a guest run reports saved and never applies account progress', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    vi.mocked(completeRun).mockResolvedValue({
      accepted: true,
      guest: true,
      mode: 'surge',
      score: 4_200,
      season: { id: 'season-1', startsAt: '', endsAt: '', durationWeeks: 1 }
    } as never)
    const { api } = mountRun()
    await flush()
    const onRecorded = vi.fn()
    await act(async () => {
      await api().complete({ answers: [] }, onRecorded)
    })
    expect(onRecorded).toHaveBeenCalledTimes(1)
    expect(applyRunProgress).not.toHaveBeenCalled()
    expect(recordingNotice.value.state).toBe('saved')
    expect(track).toHaveBeenCalledWith('game.completed', 'surge')
    expect(track).toHaveBeenCalledWith('game.personal_best', 'surge')
  })

  it('complete() on a recorded run applies progress and records a recent run', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    vi.mocked(completeRun).mockResolvedValue({
      accepted: true,
      runId: 'run-1',
      mode: 'surge',
      score: 3_100,
      season: { id: 'season-1', startsAt: '', endsAt: '', durationWeeks: 1 },
      completedAt: '2026-07-21T00:00:00.000Z',
      totalGames: 5,
      xp: 12,
      level: 2,
      levelStartGames: 0,
      nextLevelGames: 10
    } as never)
    const { api } = mountRun()
    await flush()
    const onRecorded = vi.fn()
    await act(async () => {
      await api().complete({ answers: [1] }, onRecorded)
    })
    expect(applyRunProgress).toHaveBeenCalledTimes(1)
    expect(recordRecentRun).toHaveBeenCalledTimes(1)
    expect(onRecorded).toHaveBeenCalledTimes(1)
    expect(recordingNotice.value.state).toBe('saved')
  })

  it('an expired (410) completion settles unrecorded and calls onUnrecorded', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    vi.mocked(completeRun).mockRejectedValue(new ApiError(410, 'run_expired', 'too late'))
    const { api } = mountRun()
    await flush()
    const onRecorded = vi.fn()
    const onUnrecorded = vi.fn()
    await act(async () => {
      await api().complete({ answers: [] }, onRecorded, onUnrecorded)
    })
    expect(onUnrecorded).toHaveBeenCalledTimes(1)
    expect(onRecorded).not.toHaveBeenCalled()
    expect(recordingNotice.value.state).toBe('error')
    expect((recordingNotice.value as { message: string }).message).toMatch(/signed time window/)
    expect(track).not.toHaveBeenCalledWith('game.completed', 'surge')
  })

  it('a transient failure leaves a retry notice and does not settle the run', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    vi.mocked(completeRun).mockRejectedValue(new Error('network down'))
    const { api } = mountRun()
    await flush()
    const onUnrecorded = vi.fn()
    await act(async () => {
      await api().complete({ answers: [] }, undefined, onUnrecorded)
    })
    expect(onUnrecorded).not.toHaveBeenCalled()
    expect(recordingNotice.value.state).toBe('error')
    expect((recordingNotice.value as { actionLabel: string }).actionLabel).toBe('Retry recording')
  })

  it('complete() without an active run reports the missing-signed-run error', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    // Guest completion nulls run.current; the second complete() has no run.
    vi.mocked(completeRun).mockResolvedValue({
      accepted: true,
      guest: true,
      mode: 'surge',
      score: 1,
      season: { id: 'season-1', startsAt: '', endsAt: '', durationWeeks: 1 }
    } as never)
    const { api } = mountRun()
    await flush()
    await act(async () => {
      await api().complete({ answers: [] })
    })
    await act(async () => {
      await api().complete({ answers: [] })
    })
    expect(recordingNotice.value.state).toBe('error')
    expect((recordingNotice.value as { message: string }).message).toMatch(/did not receive a signed run/)
  })
})

// =============================================================================
// use-game-session.ts (composes run + challenge content)
// =============================================================================
type SessionApi = ReturnType<typeof useGameSession<'surge', number[]>>

function mountSession(
  resolve: (challenge: { mode: 'surge'; cardIds: number[] }) => { content: number[]; assets: unknown[] },
  options?: { requireArt?: boolean }
): { api: () => SessionApi } {
  let current: SessionApi
  function Probe() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    current = useGameSession('surge', resolve as any, options)
    return null
  }
  const host = makeHost()
  void act(() => render(<Probe />, host))
  return { api: () => current }
}

describe('useGameSession', () => {
  beforeEach(() => {
    vi.mocked(startRun).mockReset()
    vi.mocked(completeRun).mockReset()
    vi.mocked(preloadImages).mockClear()
  })

  it('resolves challenge content and marks assets ready after preload', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    const resolve = vi.fn((c: { cardIds: number[] }) => ({ content: c.cardIds, assets: [] }))
    const { api } = mountSession(resolve)
    await flush()
    expect(resolve).toHaveBeenCalled()
    expect(api().content).toEqual([1, 2, 3])
    expect(api().assetsReady).toBe(true)
    expect(api().error).toBe('')
  })

  it('surfaces a resolver error as the session error', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    const resolve = () => {
      throw new Error('bad challenge shape')
    }
    const { api } = mountSession(resolve)
    await flush()
    expect(api().content).toBeNull()
    expect(api().error).toBe('bad challenge shape')
  })

  it('reports an art-load failure when required art cannot be preloaded', async () => {
    vi.mocked(startRun).mockResolvedValue(startedRun() as never)
    // Art required, assets present, but the preloader reports 0 loaded.
    vi.mocked(preloadImages).mockImplementation((_cards, done) => done(0))
    const resolve = (c: { cardIds: number[] }) => ({ content: c.cardIds, assets: [{ id: 1 }] })
    const { api } = mountSession(resolve, { requireArt: true })
    await flush()
    expect(api().content).toBeNull()
    expect(api().error).toMatch(/Card art could not be loaded/)
  })
})
