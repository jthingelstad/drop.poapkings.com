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

import HigherLower from '../../src/modes/higher-lower/HigherLower'
import Trade from '../../src/modes/trade/Trade'
import Rain from '../../src/modes/rain/Rain'
import { tradeValue } from '../../src/lib/trade'

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

// Walk the real 3-2-1 countdown (COUNTDOWN_STEP_MS = 650) to the running board.
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
// Higher / Lower — streak, advance, reset, and the shrink-window timeout miss
// ══════════════════════════════════════════════════════════════════════════════
describe('Higher / Lower — gameplay', () => {
  // pair0: right (5) is higher; pair1: left (6) is higher; pair2 spare.
  function pairs(): Array<[Card, Card]> {
    return [
      [fakeCard(101, 3, 'HL-A'), fakeCard(102, 5, 'HL-B')],
      [fakeCard(103, 6, 'HL-C'), fakeCard(104, 2, 'HL-D')],
      [fakeCard(105, 4, 'HL-E'), fakeCard(106, 1, 'HL-F')]
    ]
  }

  it('picking the higher card increments the streak and deals the next pair', async () => {
    stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)

    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Higher / Lower')
    expect(metricValue(c)).toBe('0')
    expect(c.textContent).toContain('HL-A')

    // Right card (elixir 5) is the higher cost.
    const cards = c.querySelectorAll('.ed-duel__cards button')
    await click(cards[1])
    expect(metricValue(c)).toBe('1')
    expect(c.textContent).toContain('1 streak')

    // A correct read advances after ADVANCE_DELAY_CORRECT (750ms) to pair 2.
    await advance(800)
    expect(metricValue(c)).toBe('1') // streak carried into the next pair
    expect(c.textContent).toContain('HL-C')
    expect(c.textContent).not.toContain('HL-A')
  })

  it('picking the lower card resets the streak and completes the run with the transcript', async () => {
    const session = stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)

    // Build a streak of 1 first, advance, then miss on pair 2.
    await click(c.querySelectorAll('.ed-duel__cards button')[1]) // pair0 higher → streak 1
    await advance(800)
    expect(metricValue(c)).toBe('1')

    // pair1: left (6) is higher, so the RIGHT card is the wrong (lower) pick.
    await click(c.querySelectorAll('.ed-duel__cards button')[1])
    expect(metricValue(c)).toBe('0') // streak reset

    // A miss has no summary screen: it completes the run after ADVANCE_DELAY_WRONG.
    expect(session.complete).not.toHaveBeenCalled()
    await advance(1500)
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as {
      answers: Array<{ leftId: number; rightId: number; pickedId: number }>
    }
    expect(payload.answers).toHaveLength(2)
    expect(payload.answers[0].pickedId).toBe(102) // pair0: correct higher
    expect(payload.answers[1].pickedId).toBe(104) // pair1: the lower (wrong) card
  })

  it('keeps the completed run streak available for sharing', async () => {
    const session = stage(pairs())
    session.complete.mockImplementation(async (_payload, onOk: () => void) => onOk())
    const c = mount(<HigherLower />)
    await toRunning(c)

    await click(c.querySelectorAll('.ed-duel__cards button')[1])
    await advance(800)
    await click(c.querySelectorAll('.ed-duel__cards button')[1])
    await advance(1500)

    expect(c.querySelector('.ed-duel__replay')?.textContent).toContain('1 streak')
    expect(c.querySelector('.shareline')?.textContent).toContain('Share score')
  })

  it('the shrink-window running out records the lower card as the miss', async () => {
    const session = stage(pairs())
    const c = mount(<HigherLower />)
    await toRunning(c)
    expect(metricValue(c)).toBe('0')

    // The shrink clock is a rAF loop comparing performance.now() to the round
    // window (5000ms at streak 0). Jump the clock past it and step one frame.
    mockNow += 6000
    await act(async () => {
      flushRaf()
    })

    // timeout() picked the lower card (id 101, elixir 3) as the miss.
    await advance(1500)
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as { answers: Array<{ pickedId: number }> }
    expect(payload.answers).toHaveLength(1)
    expect(payload.answers[0].pickedId).toBe(101)
    expect(metricValue(c)).toBe('0')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Trade — hidden costs, one reveal per wrong guess, solve reveals all, 8→summary
// ══════════════════════════════════════════════════════════════════════════════
describe('Trade — gameplay', () => {
  // blue total 3, red total 5 → tradeValue = +2 for every round.
  function simpleRound(i: number): { blue: Card[]; red: Card[] } {
    return { blue: [fakeCard(200 + i, 3, `B${i}`)], red: [fakeCard(300 + i, 5, `R${i}`)] }
  }
  function rounds(): Array<{ blue: Card[]; red: Card[] }> {
    return Array.from({ length: 8 }, (_, i) => simpleRound(i))
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
    const content = [round0, ...Array.from({ length: 7 }, (_, i) => simpleRound(i + 1))]
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

  it('solving all 8 exchanges lands on the summary with the run tiles and completes the run', async () => {
    const session = stage(rounds())
    const c = mount(<Trade />)
    await toRunning(c)

    // Solve each round with the correct +2; the next exchange is automatic.
    for (let round = 0; round < 8; round += 1) {
      await click(c.querySelector('[aria-label="+2 trade"]'))
      await advance(280)
    }

    // Summary screen with the three moment tiles.
    expect(c.textContent).toContain('Trade complete')
    expect(c.textContent).toContain('Clean')
    expect(c.textContent).toContain('8/8') // all clean (no wrong guesses)
    expect(c.textContent).toContain('Accuracy')
    expect(c.textContent).toContain('100%')
    expect(c.querySelector('.shareline')?.textContent).toContain('Trade')

    // The run was reported with one transcript entry per solved round.
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0][0] as { answers: Array<{ guesses: number[] }> }
    expect(payload.answers).toHaveLength(8)
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
    expect(c.textContent).toContain('♥♥♥') // all three lives intact
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
