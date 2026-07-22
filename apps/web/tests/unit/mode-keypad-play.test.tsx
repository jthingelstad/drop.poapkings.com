import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { signal } from '@preact/signals'
import type { Card } from '../../src/types'

// ── Harness ─────────────────────────────────────────────────────────────────
// This suite drives the keypad modes for REAL: the session hook is mocked (so no
// backend / signed challenge is needed) but `use-game-runtime` stays REAL, so the
// countdown → running stage machine and the per-mode answer/scoring flow actually
// execute. We advance fake timers through the 3-2-1 countdown and each answer
// "beat", clicking real keypad buttons, then assert scoring/streak/miss/summary
// plus the transcript handed to the mocked `complete`.

const hoisted = vi.hoisted(() => ({
  session: { current: null as unknown },
  records: { current: {} as Record<string, unknown> }
}))

// Mock the session hook only — the runtime hook is left real on purpose.
vi.mock('../../src/lib/use-game-session', () => ({
  useGameSession: () => hoisted.session.current
}))

// No audio, analytics, animation, or WebGL in unit tests.
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
  animate: () => ({ stop: () => {}, finished: Promise.resolve() })
}))
vi.mock('../../src/components/GameFxLayer', () => ({
  default: () => null,
  preloadGameFx: vi.fn()
}))

// Storage seam — controllable records so PB / pace branches are deterministic,
// and spies so we can assert the modes persist per-card results.
vi.mock('../../src/lib/storage', () => ({
  getRecords: () => hoisted.records.current,
  saveRecords: vi.fn((r: Record<string, unknown>) => Object.assign(hoisted.records.current, r)),
  saveResult: vi.fn(),
  recordSession: vi.fn(),
  getSettings: () => ({ inputStyle: 'keypad', sound: false, reducedMotion: false, enhancedEffects: true }),
  saveSettings: vi.fn()
}))

import { saveResult, recordSession, saveSettings } from '../../src/lib/storage'
import Surge from '../../src/modes/surge/Surge'
import Survival from '../../src/modes/survival/Survival'
import Practice from '../../src/modes/practice/Practice'

// ── Fakes ─────────────────────────────────────────────────────────────────────
function fakeCard(i: number): Card {
  const elixir = (i % 6) + 2 // 2..7 — always within the 1..9 keypad
  return {
    id: 26_000_000 + i,
    name: `Card ${i}`,
    elixir,
    rarity: 'common',
    type: 'troop',
    evo: false,
    hero: false,
    icon: `/cards/${26_000_000 + i}.png`
  }
}
function fakeCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => fakeCard(i))
}
function wrongFor(elixir: number): number {
  return elixir > 1 ? elixir - 1 : elixir + 1 // < elixir ⇒ hint "Higher"
}

interface CompletePayload {
  answers: unknown[]
}
function makeSession(content: unknown) {
  return {
    content,
    assetsReady: true,
    preparing: signal(false),
    error: '',
    prepare: vi.fn(async () => {}),
    ensureFreshRun: vi.fn(async () => true),
    complete: vi.fn((_payload: CompletePayload, onOk?: () => void) => onOk?.())
  }
}
type Session = ReturnType<typeof makeSession>

// ── Mount + interaction helpers ────────────────────────────────────────────────
const mounted: HTMLElement[] = []
function mount(vnode: preact.ComponentChild): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(vnode as never, container)
  mounted.push(container)
  return container
}

function advance(ms: number): void {
  void act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function press(host: HTMLElement, value: number): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-pip-value="${value}"]`)
  if (!btn) throw new Error(`no keypad key for ${value}`)
  void act(() => {
    btn.click()
  })
}

function clickText(host: HTMLElement, selector: string, text: string): void {
  const el = [...host.querySelectorAll<HTMLButtonElement>(selector)].find((b) => (b.textContent ?? '').includes(text))
  if (!el) throw new Error(`no ${selector} containing "${text}"`)
  void act(() => {
    el.click()
  })
}

// Start a timed mode (Surge / Survival): mount, flush the ensureFreshRun promise,
// then run the countdown out so the mode reaches the running stage.
async function startTimed(vnode: preact.ComponentChild): Promise<HTMLElement> {
  let host!: HTMLElement
  void act(() => {
    host = mount(vnode)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  advance(3 * 650 + 100) // three countdown steps (650ms each) → begin()
  return host
}

let session: Session

beforeEach(() => {
  vi.clearAllMocks() // module-level storage spies persist across tests otherwise
  vi.useFakeTimers()
  // A no-op rAF keeps the runtime's elapsed clock / Survival's per-card clock from
  // recursing or ticking; we drive every transition through setTimeout beats.
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0)
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn(() => {})
  )
  hoisted.records.current = {}
})

afterEach(() => {
  for (const c of mounted.splice(0)) {
    render(null as never, c)
    c.remove()
  }
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ══════════════════════════════════════════════════════════════════════════════
// Surge — golf-time sprint of 15; +2s per miss; the card stays until correct.
// ══════════════════════════════════════════════════════════════════════════════
describe('Surge gameplay', () => {
  it('reaches the running board through the countdown', async () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Surge />)

    expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Surge')
    expect(host.textContent).toContain('Card 1 / 15')
    expect(session.ensureFreshRun).toHaveBeenCalled()
  })

  it('scores a clean 15-card sprint and completes with a full transcript', async () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Surge />)

    for (let i = 0; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280) // CORRECT_BEAT_MS → showNext (or finish on the 15th)
    }

    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0]![0] as { answers: Array<{ cardId: number; guesses: number[] }> }
    expect(payload.answers).toHaveLength(15)
    expect(payload.answers[0]!.guesses).toEqual([cards[0]!.elixir])
    expect(payload.answers[14]!.cardId).toBe(cards[14]!.id)
    expect(saveResult).toHaveBeenCalledTimes(15)

    // Summary: first-ever run is a PB, and every first guess was right.
    expect(host.textContent).toContain('Surge complete')
    expect(host.textContent).toContain('First Surge logged')
    expect(host.textContent).toContain('100%')
  })

  it('penalizes a wrong tap, keeps the same card, then the correct tap advances', async () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Surge />)
    const e0 = cards[0]!.elixir

    press(host, wrongFor(e0)) // guess below the true cost ⇒ "Higher"
    expect(host.querySelector('.sr-only')?.textContent).toBe('Higher')
    expect(host.textContent).toContain('Card 1 / 15') // card did NOT advance

    advance(430) // WRONG_BEAT_MS → back to playing
    press(host, e0)
    advance(280)
    expect(host.textContent).toContain('Card 2 / 15') // now it advanced

    // Finish the rest cleanly; the missed card drops first-try accuracy.
    for (let i = 1; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280)
    }

    const payload = session.complete.mock.calls[0]![0] as { answers: Array<{ guesses: number[] }> }
    expect(payload.answers[0]!.guesses).toEqual([wrongFor(e0), e0]) // both taps recorded
    expect(host.textContent).toContain('93%') // 14 / 15 first-try
  })

  it('shows a prior best (not a PB) and runs the ghost-pace checkpoint', async () => {
    const cards = fakeCards(15)
    // best 0 ⇒ any elapsed ≥ 0 is not a PB; a full pace table lights the 5-solve cue.
    hoisted.records.current = { surgeBest: 0, surgeBestPace: Array.from({ length: 15 }, () => 500) }
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Surge />)
    for (let i = 0; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280)
    }

    expect(session.complete).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Surge complete')
    expect(host.textContent).toContain('Best:')
    expect(host.textContent).not.toContain('First Surge logged')
  })

  it('replays back to the loading gate and re-prepares a run', async () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Surge />)
    for (let i = 0; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280)
    }
    expect(host.textContent).toContain('Surge complete')

    clickText(host, 'button', 'Play again')
    expect(session.prepare).toHaveBeenCalled()
    expect(host.textContent).toContain('Loading cards…')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Survival — sudden death. Correct builds a streak; a miss or timeout ends it.
// ══════════════════════════════════════════════════════════════════════════════
describe('Survival gameplay', () => {
  it('builds a streak then dies on a wrong tap (new personal best)', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Survival')

    press(host, cards[0]!.elixir)
    advance(230) // nextCard beat
    press(host, cards[1]!.elixir)
    advance(230)
    expect(host.querySelector('.ed-game__metric')?.textContent).toBe('2') // streak metric

    press(host, wrongFor(cards[2]!.elixir)) // fatal miss
    advance(1100) // DEATH_BEAT_MS → finish('over')

    expect(host.textContent).toContain('Sudden death')
    expect(host.textContent).toContain('2 streak')
    expect(host.textContent).toContain('New personal best!')
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0]![0] as { answers: unknown[] }
    expect(payload.answers).toHaveLength(3) // two cleared + the death entry
  })

  it('clearing the whole deck is a win', async () => {
    const cards = fakeCards(3)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    for (let i = 0; i < 3; i++) {
      press(host, cards[i]!.elixir)
      advance(230)
    }
    advance(1100) // finish() after the deck is exhausted

    expect(host.textContent).toContain('Survival · cleared!')
    expect(host.textContent).toContain('Every card named!')
    expect(session.complete).toHaveBeenCalledTimes(1)
  })

  it('ends the run when the tab is hidden (timeout death path)', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    void act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    advance(1100)

    expect(host.textContent).toContain('Sudden death')
    expect(host.textContent).toContain('0 streak')
    expect(session.complete).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('shows the prior best when the run is not a PB', async () => {
    const cards = fakeCards(20)
    hoisted.records.current = { survivalBest: 10 }
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    press(host, cards[0]!.elixir)
    advance(230)
    press(host, wrongFor(cards[1]!.elixir))
    advance(1100)

    expect(host.textContent).toContain('1 streak')
    expect(host.textContent).toContain('Best: 10')
    expect(host.textContent).not.toContain('New personal best!')
  })

  it('replays back to the loading gate', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    press(host, wrongFor(cards[0]!.elixir))
    advance(1100)
    expect(host.textContent).toContain('Sudden death')

    clickText(host, 'button', 'Play again')
    expect(session.prepare).toHaveBeenCalled()
    expect(host.textContent).toContain('Loading cards…')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Practice — untimed round of 15, unranked; keypad or 4-choice input.
// ══════════════════════════════════════════════════════════════════════════════
describe('Practice gameplay', () => {
  it('uses the Surge card motion and no purple correct-answer treatment', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    expect(host.querySelector('.game-motion--card')).toBeTruthy()
    press(host, cards[0]!.elixir)
    expect(host.querySelector('.pcard--correct')).toBeTruthy()
    expect(host.querySelector('.pcard__cost')).toBeNull()
    expect(host.querySelector('.drop-pop-wrap')).toBeNull()

    advance(280)
    expect(host.textContent).toContain('Card 2 / 15')
  })

  it('answers a full round on the keypad → summary + complete', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })
    expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Practice')

    for (let i = 0; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280) // ADVANCE_DELAY_CORRECT → nextCard (or finishRound on the last)
    }

    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0]![0] as { answers: unknown[] }
    expect(payload.answers).toHaveLength(15)
    expect(recordSession).toHaveBeenCalled()
    expect(saveResult).toHaveBeenCalledTimes(15)
    expect(host.textContent).toContain('15 / 15 · 100%')
  })

  it('keeps a missed card active with Higher/Lower feedback and grades only the first read', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    const correctCost = cards[0]!.elixir
    press(host, correctCost - 1)
    expect(host.querySelector('[data-testid="practice-hint"]')?.textContent).toContain('Higher')
    expect(host.querySelector('.pcard__cost')).toBeNull()
    expect(host.textContent).toContain('Card 1 / 15')

    advance(430)
    press(host, correctCost + 1)
    expect(host.querySelector('[data-testid="practice-hint"]')?.textContent).toContain('Lower')
    expect(host.textContent).toContain('Card 1 / 15')

    advance(430)
    press(host, correctCost)
    advance(280)
    expect(host.textContent).toContain('Card 2 / 15')
    expect(host.querySelector('.ed-game__metric')?.textContent).toBe('0') // correct count still 0

    for (let i = 1; i < 15; i++) {
      press(host, cards[i]!.elixir)
      advance(280)
    }
    expect(host.textContent).toContain('14 / 15 · 93%')
    const payload = session.complete.mock.calls[0]![0] as { answers: Array<{ cardId: number; guess: number }> }
    expect(payload.answers).toHaveLength(15)
    expect(payload.answers[0]).toEqual({ cardId: cards[0]!.id, guess: correctCost - 1 })
    expect(saveResult).toHaveBeenCalledTimes(15)
  })

  it('switches to 4-choice input and answers through it', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    clickText(host, '.input-toggle__btn', '4 choices')
    expect(saveSettings).toHaveBeenCalledWith({ inputStyle: 'choice' })
    const choices = host.querySelector('.mc-choices')
    expect(choices).not.toBeNull()

    // A wrong choice keeps the card active and gives the same directional cue.
    const correct = host.querySelector<HTMLButtonElement>(`.mc-choices__btn[aria-label="${cards[0]!.elixir} elixir"]`)
    expect(correct).not.toBeNull()
    const wrong = [...host.querySelectorAll<HTMLButtonElement>('.mc-choices__btn')].find((button) => button !== correct)
    expect(wrong).not.toBeNull()
    void act(() => {
      wrong!.click()
    })
    const expectedHint =
      Number(wrong!.getAttribute('aria-label')?.split(' ')[0]) < cards[0]!.elixir ? 'Higher' : 'Lower'
    expect(host.querySelector('[data-testid="practice-hint"]')?.textContent).toContain(expectedHint)
    expect(host.textContent).toContain('Card 1 / 15')

    advance(430)
    void act(() => {
      correct!.click()
    })
    advance(280)
    expect(host.textContent).toContain('Card 2 / 15')
  })

  it('answers via the physical keyboard (keydown) and replays the round', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    // Drive the whole round from the keyboard number keys.
    for (let i = 0; i < 15; i++) {
      void act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: `${cards[i]!.elixir}` }))
      })
      advance(280)
    }
    expect(host.textContent).toContain('15 / 15 · 100%')

    clickText(host, 'button', 'Play again')
    expect(session.prepare).toHaveBeenCalled()
    expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Practice')
    expect(host.textContent).toContain('Card 1 / 15')
  })
})
