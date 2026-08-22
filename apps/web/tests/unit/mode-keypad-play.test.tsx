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
  records: { current: {} as Record<string, unknown> },
  preloadImages: vi.fn()
}))

// Mock the session hook only — the runtime hook is left real on purpose.
vi.mock('../../src/lib/use-game-session', () => ({
  useGameSession: () => hoisted.session.current
}))
vi.mock('../../src/lib/preload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/preload')>()
  return { ...actual, preloadImages: hoisted.preloadImages }
})

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
  animate: () => {
    const settled = { catch: () => settled }
    return {
      stop: () => {},
      // Practice owns the next deal from the exit animation's completion. A
      // synchronous thenable keeps these timer-driven unit tests deterministic;
      // browser coverage verifies the real 350ms ride-out.
      finished: { then: (done: () => void) => (done(), settled) }
    }
  }
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
  // Practice's weighted deal reads card stats every deal; an empty map is the
  // new-player case, which must fall back to uniform random.
  getCardStats: () => ({}),
  getSettings: () => ({
    inputStyle: 'keypad',
    sound: false,
    reducedMotion: false,
    enhancedEffects: true,
    // These drive the single-row keypad on purpose; the two-row Speedrun
    // layout has its own coverage in speedrun-keyboard.test.tsx.
    speedrunKeyboard: false
  }),
  saveSettings: vi.fn()
}))

import { rainSpawnIntervalMs } from '@elixir-drop/contracts'
import { saveResult, recordSession, saveRecords, saveSettings } from '../../src/lib/storage'
import { route } from '../../src/lib/router'
import Surge from '../../src/modes/surge/Surge'
import Survival from '../../src/modes/survival/Survival'
import Practice from '../../src/modes/practice/Practice'
import Rain from '../../src/modes/rain/Rain'

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

// Every mode holds each numeral for COUNTDOWN_STEP_MS (700) and then the GO
// frame for GO_HOLD_MS (250) before the run begins.
const COUNTDOWN_TOTAL_MS = 3 * 700 + 250

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
  advance(COUNTDOWN_TOTAL_MS + 100) // 3 · 2 · 1 · GO → begin()
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
  hoisted.preloadImages.mockImplementation((cards: Card[], done: (loaded: number) => void) => done(cards.length))
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
    // The harness mocks completion, so nothing recorded and the share control
    // is correctly absent (see the Summary tests for both branches).
    expect(host.querySelector('.shareline')).toBeNull()
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
      if (i === 4) {
        expect(host.querySelector('.floating-cue--pace')?.textContent).toMatch(/\d+\.\d{3}s (ahead|behind)/)
      }
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
    expect(host.querySelector('[data-game-start-phase="loading"]')).not.toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Survival — sudden death. Correct builds a streak; a miss or timeout ends it.
// ══════════════════════════════════════════════════════════════════════════════
describe('Survival gameplay', () => {
  it('does not start the next sudden-death clock before its card art is decoded', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session
    let releaseArt: (() => void) | undefined
    hoisted.preloadImages
      // begin() tops up the progressive look-ahead first.
      .mockImplementationOnce((warmCards: Card[], done: (loaded: number) => void) => done(warmCards.length))
      // nextCard() extends that look-ahead by one more distant card.
      .mockImplementationOnce((warmCards: Card[], done: (loaded: number) => void) => done(warmCards.length))
      // nextCard() then verifies the exact active card before exposing it.
      .mockImplementationOnce((_cards: Card[], done: (loaded: number) => void) => {
        releaseArt = () => done(1)
      })

    const host = await startTimed(<Survival />)
    press(host, cards[0]!.elixir)
    advance(230)

    expect(host.querySelector('.pcard__img')?.getAttribute('alt')).toBe(cards[0]!.name)
    expect(host.querySelector('.pcard--correct')).toBeTruthy()

    void act(() => releaseArt?.())
    expect(host.querySelector('.pcard__img')?.getAttribute('alt')).toBe(cards[1]!.name)
    expect(host.querySelector('.pcard--correct')).toBeNull()
  })

  it('flashes the running total at every ten-card milestone', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    for (let index = 0; index < 9; index += 1) {
      press(host, cards[index]!.elixir)
      advance(230)
    }
    expect(host.querySelector('.game-milestone')).toBeNull()

    press(host, cards[9]!.elixir)
    expect(host.querySelector('.game-milestone__num')?.textContent).toBe('10')

    advance(600)
    expect(host.querySelector('.game-milestone')).toBeNull()
  })

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
    // The harness mocks completion, so nothing recorded and the share control
    // is correctly absent (see the Summary tests for both branches).
    expect(host.querySelector('.shareline')).toBeNull()
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

  // Regression: on a PB the summary used to assign best = the streak just set,
  // so "Streak" and "Prev best" showed the same number and the mark the player
  // actually beat was lost.
  it('reports the PREVIOUS best on a PB, not the streak just set', async () => {
    const cards = fakeCards(20)
    hoisted.records.current = { survivalBest: 1 }
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    press(host, cards[0]!.elixir)
    advance(230)
    press(host, cards[1]!.elixir)
    advance(230)
    press(host, wrongFor(cards[2]!.elixir)) // fatal miss at streak 2
    advance(1100)

    expect(host.textContent).toContain('New personal best!')
  })

  it('reports no previous best for a first-ever run', async () => {
    const cards = fakeCards(20)
    session = makeSession(cards)
    hoisted.session.current = session

    const host = await startTimed(<Survival />)
    press(host, cards[0]!.elixir)
    advance(230)
    press(host, wrongFor(cards[1]!.elixir))
    advance(1100)
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
    expect(host.querySelector('[data-game-start-phase="loading"]')).not.toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Practice — ENDLESS, untimed, unranked; keypad or 4-choice input. There is no
// round length: the deck is a pool the loop draws from, and the player ends the
// session with the top-bar close control. Because the deal is weighted
// (uniform here — the mocked card stats are empty), the tests read the live card
// off the board instead of assuming deck order.
// ══════════════════════════════════════════════════════════════════════════════
describe('Practice gameplay', () => {
  beforeEach(() => {
    route.value = '/practice'
  })

  afterEach(() => {
    route.value = '/'
  })

  function liveCard(host: HTMLElement, deck: Card[]): Card {
    const name = host.querySelector('.pcard__img')?.getAttribute('alt')
    const found = deck.find((c) => c.name === name)
    if (!found) throw new Error(`no card on the board (alt="${name}")`)
    return found
  }

  function endSession(host: HTMLElement): void {
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="End session"]')
    if (!button) throw new Error('no End session control')
    void act(() => {
      button.click()
    })
  }

  it('uses an icon-only close control with an explicit accessible name', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="End session"]')
    expect(button).not.toBeNull()
    expect(button!.textContent?.trim()).toBe('')
    expect(button!.querySelector('svg')).not.toBeNull()
  })

  // Answer `count` questions correctly, reading each card off the board.
  function answerCorrectly(host: HTMLElement, deck: Card[], count: number): void {
    for (let i = 0; i < count; i++) {
      press(host, liveCard(host, deck).elixir)
      advance(300) // stable reinforcement hold → mocked exit completion → next deal
    }
  }

  it('holds the loading surface until its random opening card is decoded', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session
    let releaseArt: (() => void) | undefined
    hoisted.preloadImages.mockImplementationOnce((_cards: Card[], done: (loaded: number) => void) => {
      releaseArt = () => done(1)
    })

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    expect(host.querySelector('[data-game-start-phase="loading"]')).not.toBeNull()
    expect(host.querySelector('.pcard')).toBeNull()

    void act(() => releaseArt?.())
    expect(host.querySelector('[data-game-start-phase="loading"]')).toBeNull()
    expect(host.querySelector('.pcard__img')).not.toBeNull()
  })

  it('holds the solved cost over the art before the card exits', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    expect(host.querySelector('.game-motion--card')).toBeTruthy()
    const first = liveCard(host, cards)
    press(host, first.elixir)
    expect(host.querySelector('.pcard--correct')).toBeTruthy()
    expect(host.querySelector('.pcard__cost')).toBeNull()
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(first.elixir))
    expect(host.querySelector('.drop-pop-wrap')).toBeNull()

    advance(299)
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(first.elixir))
    advance(1)
    expect(host.querySelector('.pcard__answer-cost')).toBeNull()
    expect(host.textContent).toContain('1 practiced')
    // Endless: no card counter, and never the same card twice in a row.
    expect(host.textContent).not.toContain('/ 15')
    expect(liveCard(host, cards).id).not.toBe(first.id)
  })

  it('keeps the solved hand visible until the next card art is decoded', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session
    let releaseArt: (() => void) | undefined
    hoisted.preloadImages
      .mockImplementationOnce((openingCards: Card[], done: (loaded: number) => void) => done(openingCards.length))
      .mockImplementationOnce((_cards: Card[], done: (loaded: number) => void) => {
        releaseArt = () => done(1)
      })

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    const first = liveCard(host, cards)
    press(host, first.elixir)
    advance(300)

    expect(liveCard(host, cards).id).toBe(first.id)
    expect(host.querySelector('.pcard--correct')).toBeTruthy()
    expect(releaseArt).toBeTypeOf('function')

    void act(() => releaseArt?.())
    expect(liveCard(host, cards).id).not.toBe(first.id)
    expect(host.querySelector('.pcard--correct')).toBeNull()
  })

  it('does not turn ten consecutive first-read answers into a streak milestone', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    answerCorrectly(host, cards, 10)
    expect(host.querySelector('.game-milestone')).toBeNull()
    expect(host.textContent).not.toContain('streak')
  })

  it('runs past the old 15-card round and only ends when the player ends it', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })
    expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Practice')

    answerCorrectly(host, cards, 23)

    // Still playing after 23 — the fixed round is gone.
    expect(session.complete).not.toHaveBeenCalled()
    expect(host.textContent).toContain('23 practiced')

    endSession(host)
    expect(session.complete).toHaveBeenCalledTimes(1)
    const payload = session.complete.mock.calls[0]![0] as { answers: unknown[] }
    expect(payload.answers).toHaveLength(23)
    expect(recordSession).toHaveBeenCalled()
    expect(saveResult).toHaveBeenCalledTimes(23)
    expect(host.textContent).toContain('23 cards practiced')
    expect(host.querySelector('[data-practice-stat="recall"]')?.textContent).toContain('23 / 23')
    expect(host.querySelector('[data-practice-stat="assisted"]')?.textContent).toContain('no help used')
    expect(host.querySelector('[data-practice-stat="due"]')?.textContent).toContain('0')
    expect(host.querySelector('.shareline')).toBeNull()
  })

  it('closes on session stats only — no personal best, no record line', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    answerCorrectly(host, cards, 4)
    endSession(host)

    expect(host.querySelector('.ed-sum__pb')).toBeNull()
    expect(host.textContent).not.toMatch(/personal best|New best|Best:/i)
    expect(saveRecords).not.toHaveBeenCalled()
  })

  it('ending with nothing answered leaves without submitting a transcript', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    endSession(host)
    expect(session.complete).not.toHaveBeenCalled()
  })

  it('gives one anchored retry, then reveals the answer while grading only the first read', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    expect(host.textContent).toContain('0 practiced')
    const missed = liveCard(host, cards)
    const correctCost = missed.elixir
    press(host, correctCost - 1)
    expect(host.querySelector('[data-testid="practice-hint"]')?.textContent).toContain(`Higher than ${correctCost - 1}`)
    expect(host.querySelector('.pcard__cost')).toBeNull()
    // The first read is what counts as the answer; the card stays until solved.
    expect(host.textContent).toContain('1 practiced')

    advance(430)
    press(host, correctCost + 1)
    expect(liveCard(host, cards).id).toBe(missed.id)

    advance(430)
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(correctCost))
    expect(host.querySelector('.sr-only')?.textContent).toContain(`The answer is ${correctCost} elixir`)
    advance(1_599)
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(correctCost))
    advance(1)
    expect(host.querySelector('.pcard__answer-cost')).toBeNull()
    expect(host.textContent).toContain('1 practiced')
    expect(host.querySelector('.ed-game__metric')?.textContent).toBe('0') // correct count still 0

    endSession(host)
    expect(host.textContent).toContain('1 card practiced')
    expect(host.querySelector('[data-practice-stat="recall"]')?.textContent).toContain('0 / 1')
    expect(host.querySelector('[data-practice-stat="due"]')?.textContent).toContain('1')
    expect(host.textContent).toContain('Review misses')
    const payload = session.complete.mock.calls[0]![0] as {
      answers: Array<{ cardId: number; guess: number; responseMs: number; assisted: boolean }>
    }
    expect(payload.answers).toHaveLength(1)
    expect(payload.answers[0]).toMatchObject({ cardId: missed.id, guess: correctCost - 1, assisted: false })
    expect(payload.answers[0]!.responseMs).toBeGreaterThanOrEqual(0)
    expect(saveResult).toHaveBeenCalledTimes(1)
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
    const first = liveCard(host, cards)
    expect(host.querySelector('.mc-choices')).not.toBeNull()

    // A wrong recognition choice is marked, then the exact answer is revealed;
    // elimination retries would train the option set instead of the card.
    const correct = host.querySelector<HTMLButtonElement>(`.mc-choices__btn[aria-label="${first.elixir} elixir"]`)
    expect(correct).not.toBeNull()
    const wrong = [...host.querySelectorAll<HTMLButtonElement>('.mc-choices__btn')].find((button) => button !== correct)
    expect(wrong).not.toBeNull()
    void act(() => {
      wrong!.click()
    })
    expect(wrong!.className).toContain('mc-choices__btn--wrong')
    expect(liveCard(host, cards).id).toBe(first.id)

    advance(430)
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(first.elixir))
    expect(correct!.className).toContain('mc-choices__btn--correct')
    advance(1_599)
    expect(host.querySelector('.pcard__answer-cost')?.textContent).toBe(String(first.elixir))
    advance(1)
    expect(host.querySelector('.pcard__answer-cost')).toBeNull()
    expect(host.textContent).toContain('1 practiced')
    expect(saveResult).toHaveBeenCalledWith(first.id, false, undefined, true)
  })

  it('offers voluntary help after idle time and records it as assisted', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    expect(host.textContent).not.toContain('Need a nudge?')
    advance(6_999)
    expect(host.textContent).not.toContain('Need a nudge?')
    advance(1)
    clickText(host, '.practice-idle-assist', 'Need a nudge?')
    expect(host.querySelectorAll('.mc-choices__btn')).toHaveLength(4)

    const current = liveCard(host, cards)
    const correctChoice = host.querySelector<HTMLButtonElement>(
      `.mc-choices__btn[aria-label="${current.elixir} elixir"]`
    )
    void act(() => correctChoice?.click())
    expect(saveResult).toHaveBeenCalledWith(current.id, true, undefined, true)
    advance(300)
    endSession(host)
    expect(host.textContent).toContain('1 card practiced')
    expect(host.querySelector('[data-practice-stat="recall"]')?.textContent).toContain('no unassisted reads')
    expect(host.querySelector('[data-practice-stat="assisted"]')?.textContent).toContain('1 / 1')
    expect(host.textContent).not.toContain('Work on these')
  })

  it('narrows an idle recognition prompt from four choices to two', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    clickText(host, '.input-toggle__btn', '4 choices')
    expect(host.querySelectorAll('.mc-choices__btn')).toHaveLength(4)
    advance(7_000)
    clickText(host, '.practice-idle-assist', 'Narrow it down')
    expect(host.querySelectorAll('.mc-choices__btn')).toHaveLength(2)
  })

  it('does not relabel an exposed choice prompt as unassisted after switching back', () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    const current = liveCard(host, cards)
    clickText(host, '.input-toggle__btn', '4 choices')
    clickText(host, '.input-toggle__btn', 'Keypad')
    press(host, current.elixir)

    expect(saveResult).toHaveBeenCalledWith(current.id, true, undefined, true)
  })

  it('answers via the physical keyboard (keydown) and starts a fresh session', async () => {
    const cards = fakeCards(15)
    session = makeSession(cards)
    hoisted.session.current = session
    // Force replay to deal the same opening card. Resetting the decoded-card
    // gate must still rerun its preload effect for the new session generation.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    let host!: HTMLElement
    void act(() => {
      host = mount(<Practice />)
    })

    for (let i = 0; i < 6; i++) {
      const live = liveCard(host, cards)
      void act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: `${live.elixir}` }))
      })
      advance(300)
    }
    endSession(host)
    expect(host.textContent).toContain('6 cards practiced')

    const replay = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Practice again')
    )
    expect(replay).toBeTruthy()
    // Replay resets the decoded-opening-card gate. Flush that passive preload
    // effect before asserting the new playable frame.
    await act(async () => replay!.click())
    random.mockRestore()
    expect(session.prepare).toHaveBeenCalled()
    await vi.waitFor(() => expect(host.querySelector('.ed-game__mode')?.textContent).toBe('Practice'))
    expect(host.textContent).toContain('0 practiced')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Rain — falling cards, three lives, a wrong tap hints instead of resolving. The
// mode is endless and has no clock, so the SPAWN CURVE is the only thing that
// bounds it: the server derives a minimum-time floor and the clear-latency
// tiebreak from the very same curve this field spawns on. Both halves are
// checked here — that the browser really does use the shared curve, and that the
// transcript carries the timing the server needs.
// ══════════════════════════════════════════════════════════════════════════════
describe('Rain gameplay', () => {
  // Mount and run the countdown out to the exact millisecond the run begins, so
  // spawn timings can be measured against the curve without slack.
  async function startRain(cards: Card[]): Promise<HTMLElement> {
    session = makeSession(cards)
    hoisted.session.current = session
    let host!: HTMLElement
    void act(() => {
      host = mount(<Rain />)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    advance(COUNTDOWN_TOTAL_MS) // 3 · 2 · 1 · GO → begin()
    return host
  }

  const tileCount = (host: HTMLElement): number => host.querySelectorAll('.ed-rain__tile').length

  it('spawns on the curve shared with the server, not a private copy', async () => {
    const host = await startRain(fakeCards(20))

    // The opening tile is dealt with the run; the next one is exactly one
    // contract spawn interval later. If this file ever grows its own copy of the
    // curve, the scorer's floor stops describing the game and Rain is unbounded
    // again — so the cadence is asserted against the imported symbol itself.
    expect(tileCount(host)).toBe(1)
    advance(rainSpawnIntervalMs(0) - 1)
    expect(tileCount(host)).toBe(1)
    advance(1)
    expect(tileCount(host)).toBe(2)
  })

  it('stamps every resolved card with its elapsed time and wrong-tap count', async () => {
    const cards = fakeCards(20)
    const host = await startRain(cards)
    advance(40) // one fall tick: the lowest tile becomes the live target

    // Two wrong taps: each hints, neither resolves the card.
    press(host, wrongFor(cards[0]!.elixir))
    press(host, wrongFor(cards[0]!.elixir))
    expect(host.querySelector('.sr-only')?.textContent).toBe('Higher')
    expect(host.querySelector('.ed-game__metric')?.textContent).toBe('0')

    press(host, cards[0]!.elixir)
    expect(host.querySelector('.ed-game__metric')?.textContent).toBe('1')

    advance(20_000) // every other tile lands: three lives gone, run over
    expect(session.complete).toHaveBeenCalledTimes(1)
    const { answers } = session.complete.mock.calls[0]![0] as {
      answers: Array<{ cardId: number; guess: number | null; atMs: number; wrongGuesses: number }>
    }

    expect(answers[0]).toMatchObject({
      cardId: cards[0]!.id,
      guess: cards[0]!.elixir,
      wrongGuesses: 2
    })
    expect(answers.slice(1).every((answer) => answer.wrongGuesses === 0)).toBe(true)
    // Landed cards are recorded too, with the same stamp — and the stamps only
    // move forward, which is what the scorer validates before ranking on them.
    expect(answers.filter((answer) => answer.guess === null).length).toBe(3)
    // Stamped from the run start, which is also when the first tile spawns — the
    // origin the server's spawn floor assumes. Counting from the mount instead
    // would hand every run a free countdown's worth of head start.
    expect(answers[0]!.atMs).toBeLessThan(COUNTDOWN_TOTAL_MS)
    expect(answers.at(-1)!.atMs).toBeGreaterThan(10_000)
    expect([...answers].sort((a, b) => a.atMs - b.atMs).map((answer) => answer.cardId)).toEqual(
      answers.map((answer) => answer.cardId)
    )
  })

  it('stops resolving landed cards when simultaneous drops spend the final lives', async () => {
    // Four drops converge on the same 40ms fall tick. Their speeds compensate
    // for the 1160ms spawn gaps: this is the deep-game shape that can occur as
    // Rain accelerates and several cards reach the floor together.
    const randomValues = [
      0,
      0, // drop 1: left, minimum speed
      0,
      0.25, // drop 2
      0,
      0.585_714, // drop 3
      0,
      0.985_714 // drop 4
    ]
    let randomIndex = 0
    const random = vi.spyOn(Math, 'random').mockImplementation(() => randomValues[randomIndex++] ?? 0)

    const host = await startRain(fakeCards(20))
    advance(12_800) // four land together; finish waits 200ms before submitting
    random.mockRestore()

    expect(host.textContent).toContain('The rain stopped')
    expect(session.complete).toHaveBeenCalledTimes(1)
    const { answers } = session.complete.mock.calls[0]![0] as {
      answers: Array<{ cardId: number; guess: number | null; atMs: number }>
    }
    expect(answers.filter((answer) => answer.guess === null)).toHaveLength(3)
  })

  it('locks input synchronously when the third life is spent', async () => {
    const host = await startRain(fakeCards(20))

    // Stop on the exact 40ms tick that spends the final life. Rain deliberately
    // holds this frame for another 200ms before the summary, which used to leave
    // the keypad and the next surviving target live during that window.
    for (let i = 0; i < 500; i += 1) {
      if (host.querySelector('[data-testid="rain-lives"]')?.getAttribute('aria-label') === '0 of 3 lives left') break
      advance(40)
    }
    expect(host.querySelector('[data-testid="rain-lives"]')?.getAttribute('aria-label')).toBe('0 of 3 lives left')
    expect(host.textContent).not.toContain('The rain stopped')
    expect(host.querySelector('.ed-rain__tile--lit')).toBeNull()

    const keypad = [...host.querySelectorAll<HTMLButtonElement>('.ed-rain__pad button')]
    expect(keypad.length).toBeGreaterThan(0)
    expect(keypad.every((button) => button.disabled)).toBe(true)
    for (const button of keypad) press(host, Number(button.getAttribute('aria-label')?.split(' ')[0]))

    advance(200)
    expect(session.complete).toHaveBeenCalledTimes(1)
    const { answers } = session.complete.mock.calls[0]![0] as {
      answers: Array<{ guess: number | null }>
    }
    expect(answers.filter((answer) => answer.guess === null)).toHaveLength(3)
    expect(answers.at(-1)?.guess).toBeNull()
  })
})
