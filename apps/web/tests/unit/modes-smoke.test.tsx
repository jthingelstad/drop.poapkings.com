import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'preact'
import { signal } from '@preact/signals'
import rawCards from '@elixir-drop/game-data/cards.json'
import type { Card } from '../../src/types'

// ── Hoisted holders so the mocked game hooks return test-controlled fakes ──────
// Each mode calls useGameSession + useGameRuntime once; the mocks simply hand
// back whatever the test staged in these refs before rendering.
const hoisted = vi.hoisted(() => ({
  session: { current: null as unknown },
  runtime: { current: null as unknown }
}))

vi.mock('../../src/lib/use-game-session', () => ({
  useGameSession: () => hoisted.session.current
}))
vi.mock('../../src/lib/use-game-runtime', () => ({
  useGameRuntime: () => hoisted.runtime.current
}))

// No audio, no analytics, no animation, no WebGL in unit tests.
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
// GameFrame renders GameFxLayer, which lazy-loads Pixi (WebGL). Stub it out so
// nothing touches the GPU or the network.
vi.mock('../../src/components/GameFxLayer', () => ({
  default: () => null,
  preloadGameFx: vi.fn()
}))

// The real hooks (imported after the mocks above) for the direct-content tests.
import { setSoundEnabled, playCorrect } from '../../src/lib/sound'
import { getSettings } from '../../src/lib/storage'
import { challengePreparers } from '../../src/lib/game-challenge-content'
import { challengeCard, challengeCards, fullDeckSize } from '../../src/lib/challenge-cards'
import { preloadImages } from '../../src/lib/preload'

import Settings from '../../src/modes/settings/Settings'
import Surge from '../../src/modes/surge/Surge'
import Practice from '../../src/modes/practice/Practice'
import Survival from '../../src/modes/survival/Survival'
import HigherLower from '../../src/modes/higher-lower/HigherLower'
import Trade from '../../src/modes/trade/Trade'
import Rain from '../../src/modes/rain/Rain'

const ALL_CARDS = (rawCards as { cards: Card[] }).cards
const CARD_IDS = ALL_CARDS.map((c) => c.id)

// ── Fakes ─────────────────────────────────────────────────────────────────────
function fakeCard(i: number, elixir = (i % 9) + 1): Card {
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

interface SessionOpts {
  assetsReady?: boolean
  preparing?: boolean
  error?: string
}
function makeSession(content: unknown, opts: SessionOpts = {}) {
  return {
    challenge: signal({ mode: 'test' }),
    preparing: signal(opts.preparing ?? false),
    startError: signal(''),
    prepare: vi.fn(async () => {}),
    ensureFreshRun: vi.fn(async () => true),
    complete: vi.fn(async () => {}),
    content,
    assetsReady: opts.assetsReady ?? true,
    error: opts.error ?? ''
  }
}

function makeRuntime(stage: string) {
  return {
    stage: signal(stage),
    count: signal(3),
    elapsedMs: signal(0),
    penaltyPulse: signal(0),
    cue: signal(null),
    startTime: { current: 0 },
    penaltyMs: { current: 0 },
    emitCue: vi.fn(() => ({ id: 0, type: 'run-start', atMs: 0 })),
    later: vi.fn(),
    clearScheduled: vi.fn(),
    reset: vi.fn(),
    start: vi.fn(),
    startNow: vi.fn(),
    finish: vi.fn(),
    setStage: vi.fn(),
    addPenalty: vi.fn(),
    currentElapsed: vi.fn(() => 0)
  }
}

// ── Render harness ────────────────────────────────────────────────────────────
const mounted: HTMLElement[] = []
function mount(vnode: preact.ComponentChild): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(vnode as never, container)
  mounted.push(container)
  return container
}

let rafSpy: ReturnType<typeof vi.spyOn>
let cafSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // Stub rAF so mode animation/clock loops never actually run or recurse.
  rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0 as unknown as number)
  cafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
})
afterEach(() => {
  for (const c of mounted.splice(0)) {
    render(null as never, c)
    c.remove()
  }
  rafSpy?.mockRestore()
  cafSpy?.mockRestore()
  document.documentElement.classList.remove('reduce-motion')
})

// ══════════════════════════════════════════════════════════════════════════════
// Settings — pure-ish, real storage + real toggles
// ══════════════════════════════════════════════════════════════════════════════
describe('Settings', () => {
  function byLabel(root: HTMLElement, label: string): HTMLButtonElement {
    const el = root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
    if (!el) throw new Error(`no control labelled ${label}`)
    return el
  }
  function byText(root: HTMLElement, sel: string, text: string): HTMLButtonElement {
    const el = [...root.querySelectorAll<HTMLButtonElement>(sel)].find((b) => (b.textContent ?? '').includes(text))
    if (!el) throw new Error(`no ${sel} containing ${text}`)
    return el
  }

  it('renders headings and build metadata', () => {
    const c = mount(<Settings />)
    expect(c.textContent).toContain('Settings')
    expect(c.textContent).toContain('Build ID')
    expect(c.textContent).toContain('Build date')
  })

  it('defaults reflect stored settings (keypad input, sound off)', () => {
    const c = mount(<Settings />)
    const keypad = byText(c, '.input-toggle__btn', 'Keypad')
    expect(keypad.getAttribute('aria-pressed')).toBe('true')
    expect(byLabel(c, 'Sound effects').getAttribute('aria-checked')).toBe('false')
  })

  it('switching practice input persists inputStyle', () => {
    const c = mount(<Settings />)
    byText(c, '.input-toggle__btn', '4 choices').click()
    expect(getSettings().inputStyle).toBe('choice')
    byText(c, '.input-toggle__btn', 'Keypad').click()
    expect(getSettings().inputStyle).toBe('keypad')
  })

  it('toggling sound persists and pipes through the sound module', () => {
    const c = mount(<Settings />)
    byLabel(c, 'Sound effects').click()
    expect(getSettings().sound).toBe(true)
    expect(setSoundEnabled).toHaveBeenCalledWith(true)
    expect(playCorrect).toHaveBeenCalled()
  })

  it('toggling reduce motion persists and stamps the root class', () => {
    const c = mount(<Settings />)
    byLabel(c, 'Reduce motion').click()
    expect(getSettings().reducedMotion).toBe(true)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
  })

  it('toggling enhanced effects persists (default on → off)', () => {
    const c = mount(<Settings />)
    expect(getSettings().enhancedEffects ?? true).toBe(true)
    byLabel(c, 'Enhance effects').click()
    expect(getSettings().enhancedEffects).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// game-challenge-content — resolving each mode's signed challenge into content
// ══════════════════════════════════════════════════════════════════════════════
describe('challengePreparers', () => {
  it('surge resolves 15 cards with 15 assets', () => {
    const out = challengePreparers.surge({ mode: 'surge', cardIds: CARD_IDS.slice(0, 15) } as never)
    expect(out.content).toHaveLength(15)
    expect(out.assets).toHaveLength(15)
  })

  it('practice resolves 15 cards', () => {
    const out = challengePreparers.practice({ mode: 'practice', cardIds: CARD_IDS.slice(0, 15) } as never)
    expect(out.content).toHaveLength(15)
  })

  it('survival resolves the full deck but only preloads a handful of assets', () => {
    const out = challengePreparers.survival({ mode: 'survival', cardIds: [...CARD_IDS] } as never)
    expect(out.content).toHaveLength(fullDeckSize)
    expect(out.assets).toHaveLength(14)
  })

  it('rain resolves a variable deck and caps preloaded assets at 24', () => {
    const out = challengePreparers.rain({ mode: 'rain', cardIds: CARD_IDS.slice(0, 30) } as never)
    expect(out.content).toHaveLength(30)
    expect(out.assets).toHaveLength(24)
  })

  it('higher-lower resolves 250 pairs, preloading only the first pair', () => {
    const pairs = Array.from(
      { length: 250 },
      (_, i) => [CARD_IDS[i % CARD_IDS.length], CARD_IDS[(i + 1) % CARD_IDS.length]] as [number, number]
    )
    const out = challengePreparers['higher-lower']({ mode: 'higher-lower', pairs } as never)
    expect(out.content).toHaveLength(250)
    expect(out.assets).toHaveLength(2)
  })

  it('trade resolves 8 rounds of blue/red cards', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => ({
      blueIds: [CARD_IDS[i]],
      redIds: [CARD_IDS[i + 8]]
    }))
    const out = challengePreparers.trade({ mode: 'trade', rounds } as never)
    expect(out.content).toHaveLength(8)
    expect(out.content[0]!.blue).toHaveLength(1)
    expect(out.content[0]!.red).toHaveLength(1)
  })

  it('rejects a challenge whose card count is wrong', () => {
    expect(() => challengePreparers.surge({ mode: 'surge', cardIds: CARD_IDS.slice(0, 3) } as never)).toThrow(
      /invalid signed Surge/
    )
  })

  it('rejects a challenge with an unresolvable card id', () => {
    const bad = [...CARD_IDS.slice(0, 14), -1]
    expect(() => challengePreparers.surge({ mode: 'surge', cardIds: bad } as never)).toThrow()
  })

  it('rejects an empty rain deck', () => {
    expect(() => challengePreparers.rain({ mode: 'rain', cardIds: [] } as never)).toThrow(/invalid signed Rain/)
  })

  it('rejects higher-lower with the wrong pair count', () => {
    expect(() => challengePreparers['higher-lower']({ mode: 'higher-lower', pairs: [] } as never)).toThrow(
      /Higher or Lower/
    )
  })

  it('rejects trade with the wrong round count', () => {
    expect(() => challengePreparers.trade({ mode: 'trade', rounds: [] } as never)).toThrow(/invalid signed Trade/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// challenge-cards — id → Card resolution against the committed snapshot
// ══════════════════════════════════════════════════════════════════════════════
describe('challenge-cards', () => {
  it('fullDeckSize matches the snapshot count', () => {
    expect(fullDeckSize).toBe(ALL_CARDS.length)
  })

  it('challengeCard resolves a known id and misses an unknown one', () => {
    expect(challengeCard(CARD_IDS[0]!)?.id).toBe(CARD_IDS[0])
    expect(challengeCard(-999)).toBeUndefined()
  })

  it('challengeCards resolves all-known ids and returns [] on any miss', () => {
    expect(challengeCards(CARD_IDS.slice(0, 5))).toHaveLength(5)
    expect(challengeCards([CARD_IDS[0]!, -999])).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// preload — settles without hanging and never loads over the network
// ══════════════════════════════════════════════════════════════════════════════
describe('preloadImages', () => {
  it('resolves immediately with 0 when there are no image urls', () => {
    const done = vi.fn()
    preloadImages([{ ...fakeCard(1), icon: '' }], done)
    expect(done).toHaveBeenCalledWith(0)
  })

  it('settles via the timeout when images never load (jsdom)', () => {
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      preloadImages(fakeCards(3), done, 2500)
      expect(done).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2500)
      expect(done).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Mode smoke — render each mode across its loading / countdown / running stages
// with the game hooks mocked so nothing hits a backend.
// ══════════════════════════════════════════════════════════════════════════════
function stageSession(content: unknown, stage: string, opts: SessionOpts = {}) {
  hoisted.session.current = makeSession(content, opts)
  hoisted.runtime.current = makeRuntime(stage)
}

describe('mode smoke — Surge', () => {
  it('shows the loading screen before assets are ready', () => {
    stageSession(fakeCards(15), 'ready', { assetsReady: false })
    const c = mount(<Surge />)
    expect(c.textContent).toContain('Loading cards…')
  })

  it('renders the countdown chrome', () => {
    stageSession(fakeCards(15), 'countdown')
    const c = mount(<Surge />)
    expect(c.querySelector('.ed-game__count')).not.toBeNull()
  })

  it('renders the running board (keypad + hint)', () => {
    stageSession(fakeCards(15), 'running')
    const c = mount(<Surge />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Surge')
    expect(c.textContent).toContain('Tap the elixir cost')
  })

  it('falls back to the run gate when preparation fails', () => {
    hoisted.session.current = makeSession(null, { preparing: false, error: 'Player services down' })
    hoisted.runtime.current = makeRuntime('ready')
    const c = mount(<Surge />)
    expect(c.textContent).toContain('This game could not start')
    expect(c.textContent).toContain('Player services down')
  })

  it('shows the preparing gate while a signed run is created', () => {
    hoisted.session.current = makeSession(null, { preparing: true })
    hoisted.runtime.current = makeRuntime('ready')
    const c = mount(<Surge />)
    expect(c.textContent).toContain('Preparing your game…')
  })
})

describe('mode smoke — Practice', () => {
  it('renders the running board', () => {
    stageSession(fakeCards(15), 'running')
    const c = mount(<Practice />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Practice')
    expect(c.textContent).toContain('Tap the elixir cost')
  })
})

describe('mode smoke — Survival', () => {
  it('shows the loading screen', () => {
    stageSession(fakeCards(20), 'ready', { assetsReady: false })
    const c = mount(<Survival />)
    expect(c.textContent).toContain('Loading cards…')
  })

  it('renders the running board (sudden death)', () => {
    stageSession(fakeCards(20), 'running')
    const c = mount(<Survival />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Survival')
    expect(c.textContent).toContain('Tap the elixir cost')
  })
})

describe('mode smoke — Higher / Lower', () => {
  it('renders the duel prompt while running', () => {
    const pairs: Array<[Card, Card]> = [
      [fakeCard(1, 3), fakeCard(2, 5)],
      [fakeCard(3, 4), fakeCard(4, 2)]
    ]
    stageSession(pairs, 'running')
    const c = mount(<HigherLower />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Higher / Lower')
    expect(c.textContent).toContain('Which costs more?')
  })
})

describe('mode smoke — Trade', () => {
  it('renders the exchange prompt while running', () => {
    const rounds = [
      { blue: [fakeCard(1, 3), fakeCard(2, 4)], red: [fakeCard(3, 5)] },
      { blue: [fakeCard(4, 2)], red: [fakeCard(5, 6)] }
    ]
    stageSession(rounds, 'running')
    const c = mount(<Trade />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Trade')
    expect(c.textContent).toContain('Elixir swing from your side?')
  })
})

describe('mode smoke — Rain', () => {
  it('shows the loading screen', () => {
    stageSession(fakeCards(30), 'ready', { assetsReady: false })
    const c = mount(<Rain />)
    expect(c.textContent).toContain('Loading cards…')
  })

  it('renders the falling field while running', () => {
    stageSession(fakeCards(30), 'running')
    const c = mount(<Rain />)
    expect(c.querySelector('.ed-game__mode')?.textContent).toBe('Rain')
    expect(c.querySelector('.ed-rain__field')).not.toBeNull()
    expect(c.textContent).toContain('Clear the lit card before it lands')
  })
})
