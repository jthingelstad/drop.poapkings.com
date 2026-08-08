import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { signal } from '@preact/signals'
import type { Card } from '../../src/types'

// ── The one hook we fake: use-game-session. use-game-runtime stays REAL, so the
// tests drive the actual countdown → running → gameplay flow (fake timers step
// the 3-2-1). Each mode calls useGameSession once; the mock returns whatever the
// test staged in this holder before mounting. ──────────────────────────────────
const hoisted = vi.hoisted(() => ({ session: { current: null as unknown } }))
vi.mock('../../src/lib/use-game-session', () => ({
  useGameSession: () => hoisted.session.current
}))

// No audio, no animation, no analytics, no WebGL.
vi.mock('../../src/lib/sound', () => ({
  initSound: vi.fn(),
  setSoundEnabled: vi.fn(),
  playCorrect: vi.fn(),
  playWrong: vi.fn(),
  playTap: vi.fn(),
  playCountdownTick: vi.fn(),
  playGo: vi.fn(),
  playRainClear: vi.fn(),
  playRainMiss: vi.fn()
}))
vi.mock('../../src/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('motion', () => ({
  animate: () => ({ stop: () => undefined, finished: Promise.resolve() })
}))
// GameFrame renders GameFxLayer, which lazy-loads Pixi (WebGL). Stub it so no
// GPU/network is touched (this also covers Rain, whose only Pixi path is here).
vi.mock('../../src/components/GameFxLayer', () => ({
  default: () => null,
  preloadGameFx: vi.fn()
}))
// getRecords/saveRecords are the only storage calls these modes make for
// best-score reads; stub them so no prior best leaks in. getSettings stays real
// (localStorage-backed via the test setup) for the motion/effects gates.
vi.mock('../../src/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/storage')>()
  return { ...actual, getRecords: vi.fn(() => ({}) as ReturnType<typeof actual.getRecords>), saveRecords: vi.fn() }
})

import { TRADE_LADDER, TRADE_ROUNDS } from '@elixir-drop/contracts'
import HigherLower from '../../src/modes/higher-lower/HigherLower'
import Trade from '../../src/modes/trade/Trade'
import Rain from '../../src/modes/rain/Rain'
import { tradeValue } from '../../src/lib/trade'
import { getRecords, saveRecords } from '../../src/lib/storage'

// ── Fakes ───────────────────────────────────────────────────────────────────
function fakeCard(id: number, elixir: number, name = `Card ${id}`): Card {
  return { id, name, elixir, rarity: 'common', type: 'troop', evo: false, hero: false, icon: `/cards/${id}.png` }
}

interface FakeSession {
  challenge: ReturnType<typeof signal>
  preparing: ReturnType<typeof signal<boolean>>
  startError: ReturnType<typeof signal<string>>
  prepare: ReturnType<typeof vi.fn>
  ensureFreshRun: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  content: unknown
  assetsReady: boolean
  error: string
}

function makeSession(content: unknown): FakeSession {
  return {
    challenge: signal({ mode: 'test' }),
    preparing: signal(false),
    startError: signal(''),
    prepare: vi.fn(async () => undefined),
    ensureFreshRun: vi.fn(async () => true),
    // The real callers pass (payload, onOk, onErr); we capture the payload and
    // deliberately DO NOT fire the callbacks, so post-complete state stays put
    // for assertions (no restart/replay races).
    complete: vi.fn(async () => undefined),
    content,
    assetsReady: true,
    error: ''
  }
}

function stage(content: unknown): FakeSession {
  const session = makeSession(content)
  hoisted.session.current = session
  return session
}

// ── Render harness ───────────────────────────────────────────────────────────
const mounted: HTMLElement[] = []
function mount(vnode: preact.ComponentChild): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(vnode as never, container)
  mounted.push(container)
  return container
}

// Controllable clock + rAF so the shrink-window loop can be stepped by hand.
let mockNow = 1000
let rafCb: FrameRequestCallback | null = null
function flushRaf(): void {
  const cb = rafCb
  rafCb = null
  if (cb) cb(mockNow)
}

// One tick of driving: settle pending microtasks (async ensureFreshRun → start)
// then push the fake clock forward, all inside act so effects/signals flush.
async function step(ms: number): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    vi.advanceTimersByTime(ms)
  })
}
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}
async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    ;(el as HTMLButtonElement).click()
  })
}

// Walk the real 3 · 2 · 1 · GO countdown (700ms a numeral, 250ms on GO) to the
// running board.
// Small steps interleave the async start()'s microtasks with the countdown
// timers and stop the moment the board appears (minimal overshoot into play).
async function toRunning(root: HTMLElement): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (root.querySelector('.ed-game__mode')) return
    await step(200)
  }
}

function metricValue(root: HTMLElement): string {
  return root.querySelector('.ed-game__metric')?.textContent ?? ''
}

// Read one of the summary's three "moment" tiles by its label.
function tileValue(root: HTMLElement, label: string): string | undefined {
  const tile = [...root.querySelectorAll('.ed-sum-tile')].find(
    (t) => t.querySelector('.ed-sum-tile__label')?.textContent === label
  )
  return tile?.querySelector('.ed-sum-tile__value')?.textContent ?? undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  mockNow = 1000
  rafCb = null
  vi.spyOn(performance, 'now').mockImplementation(() => mockNow)
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCb = cb
    return 1
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
    rafCb = null
  })
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  for (const c of mounted.splice(0)) {
    render(null as never, c)
    c.remove()
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.documentElement.classList.remove('reduce-motion')
})

// ══════════════════════════════════════════════════════════════════════════════
// Higher / Lower — three lives, a score that survives misses, and the
// shrink-window timeout (which costs a life like any other miss)
// ══════════════════════════════════════════════════════════════════════════════
describe('Higher / Lower — gameplay', () => {
  // Every pair's RIGHT card is the lower cost, so index 0 is always the correct
  // tap and index 1 is always the miss — six of them, enough to spend 3 lives.
  function pairs(): Array<[Card, Card]> {
    return Array.from(
      { length: 6 },
      (_unused, index) =>
        [fakeCard(101 + index * 2, 6, `HL-${index}a`), fakeCard(102 + index * 2, 1, `HL-${index}b`)] as [Card, Card]
    )
  }
  const higher = (c: HTMLElement) => c.querySelectorAll('.ed-duel__cards button')[0]
  const lower = (c: HTMLElement) => c.querySelectorAll('.ed-duel__cards button')[1]
  const livesLabel = (c: HTMLElement) =>
    c.querySelector('[data-testid="higher-lower-lives"]')?.getAttribute('aria-label')

  it('picking the higher card scores and deals the next pair', async () => {
    stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)

    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Higher / Lower')
    expect(metricValue(c)).toBe('0')
    expect(livesLabel(c)).toBe('3 of 3 lives left')
    // Lives are lucide glyphs (CLAUDE.md forbids hand-typed symbols), rendered
    // by the shared LivesRow that Rain uses too.
    expect(c.querySelectorAll('[data-testid="higher-lower-lives"] .icon')).toHaveLength(3)
    expect(c.textContent).toContain('HL-0a')

    await click(higher(c))
    expect(metricValue(c)).toBe('1')
    expect(c.textContent).toContain('1 correct')

    // A correct read advances after ADVANCE_DELAY_CORRECT (750ms) to pair 2.
    await advance(800)
    expect(metricValue(c)).toBe('1') // the score carries into the next pair
    expect(c.textContent).toContain('HL-1a')
    expect(c.textContent).not.toContain('HL-0a')
  })

  it('a miss costs one life and the run keeps counting through it', async () => {
    const session = stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)

    await click(higher(c)) // pair0 correct → 1
    await advance(800)
    await click(lower(c)) // pair1 miss → a life, not the run
    expect(metricValue(c)).toBe('1') // the score does NOT reset
    expect(livesLabel(c)).toBe('2 of 3 lives left')
    expect(c.querySelector('.ed-duel__card--wrong')).not.toBeNull()
    expect(c.querySelector('.ed-duel__card--correct')).not.toBeNull() // the answer is revealed

    // The run continues after ADVANCE_DELAY_WRONG — nothing is recorded yet.
    await advance(1500)
    expect(session.complete).not.toHaveBeenCalled()
    expect(c.textContent).toContain('HL-2a')

    // A later correct read still adds to the total, so the score is every
    // correct answer in the session and not the longest unbroken run.
    await click(higher(c))
    expect(metricValue(c)).toBe('2')
  })

  it('the third miss ends the run and reports the total correct', async () => {
    const session = stage(pairs())
    session.complete.mockImplementation(async (_payload, onOk: () => void) => onOk())
    const c = mount(<HigherLower />)
    await toRunning(c)

    await click(higher(c)) // 1 correct
    await advance(800)
    for (const life of [2, 1, 0]) {
      await click(lower(c))
      expect(livesLabel(c)).toBe(`${life} of 3 lives left`)
      await advance(1500)
    }

    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as {
      answers: Array<{ leftId: number; rightId: number; pickedId: number }>
    }
    // One entry per pair PRESENTED — the misses are in the transcript too.
    expect(payload.answers).toHaveLength(4)
    expect(payload.answers[0].pickedId).toBe(101) // the higher card
    expect(payload.answers.slice(1).map((answer) => answer.pickedId)).toEqual([104, 106, 108])

    expect(c.querySelector('[data-summary]')?.textContent).toContain('Higher / Lower complete')
    expect(c.querySelector('.ed-sum__headline')?.textContent).toBe('1 correct')
    expect(c.querySelector('.ed-duel')).toBeNull()
    expect(c.querySelector('.shareline')?.textContent).toContain('Share score')
    expect(c.querySelector('.ed-sum__actions')?.textContent).toContain('Play again')
    expect(c.querySelector('.ed-sum__actions')?.textContent).toContain('Home')
  })

  // All the count modes read "Prev best" the same way: the record that stood
  // BEFORE this run, with a recorded 0 treated as no best at all.
  it('reports the standing record as the previous best, never the run just played', async () => {
    vi.mocked(getRecords).mockReturnValue({ higherLowerContinuousBest: 5 })
    const session = stage(pairs())
    session.complete.mockImplementation(async (_payload, onOk: () => void) => onOk())
    const c = mount(<HigherLower />)
    await toRunning(c)

    await click(higher(c)) // 1 correct
    await advance(800)
    for (let miss = 0; miss < 3; miss += 1) {
      await click(lower(c))
      await advance(1500)
    }

    expect(c.querySelector('.ed-sum__headline')?.textContent).toBe('1 correct')
    expect(tileValue(c, 'Correct')).toBe('1')
    expect(tileValue(c, 'Prev best')).toBe('5')
    expect(c.textContent).toContain('Best: 5')
  })

  // This test previously asserted that a timeout "records the lower card", which
  // is exactly the bug it was meant to guard: the client synthesized a tap on the
  // player's behalf, so the reveal blamed a card they never touched and the
  // transcript could not tell a timeout from a wrong answer. A timeout carries no
  // pick at all.
  it('the shrink-window running out costs a life and records a timeout, not a pick', async () => {
    const session = stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)
    expect(metricValue(c)).toBe('0')

    // The shrink clock is a rAF loop comparing performance.now() to the round
    // window (5000ms at round 0). Jump the clock past it and step one frame.
    const timeOut = async () => {
      mockNow += 6000
      await act(async () => {
        flushRaf()
      })
      await advance(1500)
    }

    await timeOut()
    // A timeout is a miss: one life, and the run carries on.
    expect(livesLabel(c)).toBe('2 of 3 lives left')
    expect(session.complete).not.toHaveBeenCalled()

    await timeOut()
    await timeOut()
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as {
      answers: Array<{ pickedId?: number; timedOut?: boolean }>
    }
    // Every round ended on the clock: flagged as a timeout, with NO pickedId.
    expect(payload.answers.map((answer) => answer.timedOut)).toEqual([true, true, true])
    expect(payload.answers.every((answer) => answer.pickedId === undefined)).toBe(true)
    expect(metricValue(c)).toBe('0')
  })

  it('a timeout says "Time\'s up" instead of blaming a card the player never tapped', async () => {
    stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)
    expect(c.querySelector('[data-testid="higher-lower-prompt"]')?.textContent).toContain('Which costs more?')

    mockNow += 6000
    await act(async () => {
      flushRaf()
    })

    expect(c.querySelector('[data-testid="higher-lower-prompt"]')?.textContent).toContain("Time's up")
    // No card is marked as the player's wrong pick, because there wasn't one.
    expect(c.querySelector('.ed-duel__card--wrong')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Trade — hidden costs, one reveal per wrong guess, solve reveals all,
// ten ladder exchanges → summary
// ══════════════════════════════════════════════════════════════════════════════
describe('Trade — gameplay', () => {
  // A round of the real board shape for its rung of the ladder, dealt so every
  // round swings +2: blue cards all cost 3, and red totals that plus two.
  function simpleRound(i: number): { blue: Card[]; red: Card[] } {
    const board = TRADE_LADDER[i]!
    const blue = Array.from({ length: board.blue }, (_, n) => fakeCard(200 + i * 10 + n, 3, `B${i}-${n}`))
    const lastRedCost = 3 * (board.blue - board.red + 1) + 2
    const red = Array.from({ length: board.red }, (_, n) =>
      fakeCard(300 + i * 10 + n, n === board.red - 1 ? lastRedCost : 3, `R${i}-${n}`)
    )
    return { blue, red }
  }
  function rounds(): Array<{ blue: Card[]; red: Card[] }> {
    return TRADE_LADDER.map((_board, i) => simpleRound(i))
  }

  it('every round in the fixture swings +2 (sanity via tradeValue)', () => {
    for (const round of rounds()) expect(tradeValue(round)).toBe(2)
  })

  it('each wrong guess reveals exactly one more card cost, then the swing button reveals all', async () => {
    // round0 has three hidden cards of distinct cost so the hint order is known:
    // pickTradeHintCard reveals highest-elixir first → RC(4), then BA(3).
    const round0 = {
      blue: [fakeCard(201, 3, 'BA')],
      red: [fakeCard(202, 1, 'RB'), fakeCard(203, 4, 'RC')]
    }
    const content = [round0, ...TRADE_LADDER.slice(1).map((_board, i) => simpleRound(i + 1))]
    stage(content)
    const c = mount(<Trade />)
    await toRunning(c)

    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Trade')
    // Costs hidden at the start of the round.
    expect(c.querySelectorAll('.ed-trade__card--revealed')).toHaveLength(0)

    // Wrong guess #1 (EVEN, answer is +2) reveals ONE card + fires the hint cue.
    await click(c.querySelector('[aria-label="Even trade"]'))
    expect(c.querySelectorAll('.ed-trade__card--revealed')).toHaveLength(1)
    expect(c.querySelector('[data-testid="trade-hint"]')?.textContent).toBe('Cost revealed')

    // The wrong-beat (720ms) clears feedback so the pad is live again.
    await advance(800)
    // Wrong guess #2 reveals a SECOND card.
    await click(c.querySelector('[aria-label="Even trade"]'))
    expect(c.querySelectorAll('.ed-trade__card--revealed')).toHaveLength(2)
    await advance(800)

    // The correct swing (+2) briefly reveals every cost and the math, with no
    // manual Next button, then deals the next exchange automatically.
    await click(c.querySelector('[aria-label="+2 trade"]'))
    expect(c.querySelectorAll('.ed-trade__card--revealed')).toHaveLength(3)
    expect(c.querySelector('[data-testid="trade-math"]')).not.toBeNull()
    expect(c.textContent).not.toContain('Next trade')
    await advance(279)
    expect(c.querySelector('.ed-trade__teams')?.getAttribute('data-trade-index')).toBe('1')
    await advance(1)
    expect(c.querySelector('.ed-trade__teams')?.getAttribute('data-trade-index')).toBe('2')
  })

  it('solving all ten exchanges lands on the summary with the run tiles and completes the run', async () => {
    const session = stage(rounds())
    const c = mount(<Trade />)
    await toRunning(c)

    // Solve each round with the correct +2; the next exchange is automatic.
    for (let round = 0; round < TRADE_ROUNDS; round += 1) {
      await click(c.querySelector('[aria-label="+2 trade"]'))
      await advance(280)
    }

    // Summary screen with the three moment tiles.
    expect(c.textContent).toContain('Trade complete')
    expect(c.textContent).toContain('Clean')
    expect(c.textContent).toContain(`${TRADE_ROUNDS}/${TRADE_ROUNDS}`) // all clean (no wrong guesses)
    expect(c.textContent).toContain('Accuracy')
    expect(c.textContent).toContain('100%')
    expect(c.querySelector('.shareline')?.textContent).toContain('Trade')

    // The run was reported with one transcript entry per solved round.
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as { answers: Array<{ guesses: number[] }> }
    expect(payload.answers).toHaveLength(TRADE_ROUNDS)
    expect(payload.answers[0].guesses).toEqual([2]) // one clean guess per round
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Rain — clear vs wrong tap (lives + hint), run end → score = cleared count
// ══════════════════════════════════════════════════════════════════════════════
describe('Rain — gameplay', () => {
  function deck(): Card[] {
    // deck[0] (the first spawned/lit target) is a 3-cost.
    return [
      fakeCard(401, 3, 'RN-A'),
      fakeCard(402, 6, 'RN-B'),
      fakeCard(403, 2, 'RN-C'),
      fakeCard(404, 4, 'RN-D'),
      fakeCard(405, 5, 'RN-E'),
      fakeCard(406, 1, 'RN-F')
    ]
  }

  it('tapping the lit card cost clears it and scores', async () => {
    stage(deck())
    const c = mount(<Rain />)
    await toRunning(c)

    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Rain')
    expect(metricValue(c)).toBe('0')

    // First real drop spawns ~900ms into the run (onBegin.s pre-render spawn is a
    // no-op); step past it so exactly one drop is falling and lit as the target.
    await advance(1000)

    // The first drop (deck[0], cost 3) is the live target once a tick has run.
    await click(c.querySelector('[aria-label="3 elixir"]'))
    expect(metricValue(c)).toBe('1') // one cleared
    expect(c.querySelector('.sr-only')?.textContent).toBe('') // no wrong-tap hint
  })

  it('a wrong tap does not resolve the card and shows a higher/lower hint', async () => {
    stage(deck())
    const c = mount(<Rain />)
    await toRunning(c)
    await advance(1000) // let the first drop spawn + light up as the target

    // Target cost is 3; tapping 5 is too high → "Lower" nudge, no score, no life lost.
    await click(c.querySelector('[aria-label="5 elixir"]'))
    expect(metricValue(c)).toBe('0')
    expect(c.querySelector('.sr-only')?.textContent).toBe('Lower')
    expect(c.querySelector('[data-testid="rain-hint"]')?.textContent).toContain('Lower')
    // Lives are lucide glyphs (CLAUDE.md forbids hand-typed symbols), so the
    // count lives on the row's accessible name, not in its text.
    expect(c.querySelector('[data-testid="rain-lives"]')?.getAttribute('aria-label')).toBe('3 of 3 lives left')
    expect(c.querySelectorAll('[data-testid="rain-lives"] .icon')).toHaveLength(3)
  })

  it('flashes the running total every 10 clears, then clears it', async () => {
    // A one-card deck (cost 3) that wraps, so the lit target's cost is always 3.
    stage([fakeCard(401, 3, 'RN-A')])
    const c = mount(<Rain />)
    await toRunning(c)

    // Each beat waits past one spawn gap (>1160ms at low scores) so a fresh card
    // is on the field and a tick has lit it as the target, then clears it.
    const tap = async () => {
      await advance(1300)
      await click(c.querySelector('[aria-label="3 elixir"]'))
    }

    for (let i = 0; i < 9; i += 1) await tap()
    expect(metricValue(c)).toBe('9')
    // Nothing showing before the 10th — it is not a per-card cue.
    expect(c.querySelector('.game-milestone')).toBeNull()

    await tap()
    expect(metricValue(c)).toBe('10')
    expect(c.querySelector('.game-milestone__num')?.textContent).toBe('10')

    // It is transient: gone after the ~0.5s window.
    await advance(600)
    expect(c.querySelector('.game-milestone')).toBeNull()
  })

  // Regression: Rain used to call saveRecords({ rainBest }) inside finish(),
  // before the server verdict — so a rejected run still showed as a personal
  // best on that device (and double-wrote with recordAllTimeBest). The local
  // best is now written centrally, and only when the run is accepted.
  it('never writes the local best from finish() — only a server-accepted run may', async () => {
    vi.mocked(getRecords).mockReturnValue({ rainBest: 1 })
    // A one-card deck (cost 3) that wraps, so the lit target is always a 3.
    const session = stage([fakeCard(401, 3, 'RN-A')])
    const c = mount(<Rain />)
    await toRunning(c)

    const tap = async () => {
      await advance(1300)
      await click(c.querySelector('[aria-label="3 elixir"]'))
    }
    await tap()
    await tap()
    expect(metricValue(c)).toBe('2') // beats the standing best of 1

    await advance(20000) // drops land, 3 lives gone → endRain → finish → 'over'

    expect(c.textContent).toContain('The rain stopped')
    expect(saveRecords).not.toHaveBeenCalled()
    expect(session.complete).toHaveBeenCalledTimes(1)
    // The summary still reports the personal best off the pre-run record.
    expect(c.textContent).toContain('New best! +1')
    expect(tileValue(c, 'Cleared')).toBe('2')
    expect(tileValue(c, 'Prev best')).toBe('1')
  })

  it('losing all three lives ends the run and the summary shows the cleared count', async () => {
    const session = stage(deck())
    const c = mount(<Rain />)
    await toRunning(c)
    await advance(1000) // let the first drop spawn + light up as the target

    // Clear one card first, then let cards fall and land until 3 lives are gone.
    await click(c.querySelector('[aria-label="3 elixir"]'))
    expect(metricValue(c)).toBe('1')

    await advance(20000) // drops land (3 lives lost) → endRain → finish → 'over'

    expect(c.textContent).toContain('The rain stopped')
    expect(c.textContent).toContain('1 cleared') // score = one cleared card
    expect(c.querySelector('.shareline')?.textContent).toContain('Rain · 1 cleared')
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as { answers: Array<{ cardId: number; guess: number | null }> }
    // The cleared card is recorded with its cost; landed cards with a null guess.
    expect(payload.answers.some((a) => a.guess === 3)).toBe(true)
    expect(payload.answers.some((a) => a.guess === null)).toBe(true)
  })
})
