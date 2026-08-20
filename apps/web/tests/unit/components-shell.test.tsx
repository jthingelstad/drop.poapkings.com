import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import type { VNode } from 'preact'
import { act } from 'preact/test-utils'
import type { GameRuntimeCue } from '../../src/lib/game-runtime'

// --- Hoisted mocks (referenced from vi.mock factories) --------------------

const motionMock = vi.hoisted(() => ({
  animate: vi.fn(() => ({ finished: Promise.resolve(), stop: () => {} }))
}))

const soundMock = vi.hoisted(() => ({
  playTap: vi.fn(),
  playCorrect: vi.fn(),
  playWrong: vi.fn(),
  playCountdownTick: vi.fn(),
  playGo: vi.fn(),
  playRainClear: vi.fn(),
  playRainMiss: vi.fn(),
  initSound: vi.fn(),
  setSoundEnabled: vi.fn()
}))

const screensaverMock = vi.hoisted(() => ({
  cycleDesktopFallingCards: vi.fn(),
  screensaverActive: { value: null as null | 'tap' | 'idle' | 'nav' },
  desktopFallingCardsMode: { value: 'off' as 'subtle' | 'ambient' | 'off' }
}))

const rainMock = vi.hoisted(() => ({
  createElixirRain: vi.fn(async () => ({ destroy: vi.fn(), setEnabled: vi.fn(), setForeground: vi.fn() }))
}))

const apiMock = vi.hoisted(() => ({
  getLeaderboard: vi.fn(),
  getActivity: vi.fn()
}))

const pixiStub = vi.hoisted(() => {
  class Graphics {
    x = 0
    y = 0
    rotation = 0
    alpha = 1
    position = { set: () => {} }
    scale = { set: () => {} }
    circle() {
      return this
    }
    fill() {
      return this
    }
    destroy() {}
  }
  class Application {
    canvas = document.createElement('canvas')
    stage = { addChild: () => {}, removeChild: () => {} }
    ticker = { add: () => {}, stop: () => {}, remove: () => {} }
    screen = { width: 300, height: 200 }
    async init() {}
    destroy() {}
  }
  const module = { Application, Graphics }
  return { ...module, loadPixi: vi.fn(() => Promise.resolve(module)) }
})

vi.mock('motion', () => ({ animate: motionMock.animate }))
vi.mock('../../src/lib/sound', () => soundMock)
vi.mock('../../src/lib/screensaver', () => screensaverMock)
vi.mock('../../src/components/ScreensaverScene', () => rainMock)
vi.mock('../../src/lib/load-pixi', () => ({
  loadPixi: pixiStub.loadPixi
}))
vi.mock('../../src/lib/api', () => ({
  getLeaderboard: apiMock.getLeaderboard,
  getActivity: apiMock.getActivity
}))

// --- Static imports (original module singletons) --------------------------

import PipKeypad from '../../src/components/PipKeypad'
import MultipleChoice from '../../src/components/MultipleChoice'
import GameFrame from '../../src/components/game/GameFrame'
import FloatingCue from '../../src/components/FloatingCue'
import GameMotion from '../../src/components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../src/components/GameFxLayer'
import MobileShell from '../../src/components/shell/MobileShell'
import DesktopAside from '../../src/components/shell/DesktopAside'
import DesktopNav from '../../src/components/shell/DesktopNav'
import { route } from '../../src/lib/router'
import { player, accountStatus } from '../../src/lib/account'
import { apiAvailability, transportOffline } from '../../src/lib/api-availability'
import { offlineRunMode } from '../../src/lib/use-game-run'
import { layout } from '../../src/lib/use-layout'
import { keyboardHelpOpen } from '../../src/lib/keyboard-help'

// --- Helpers --------------------------------------------------------------

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function cue(id: number, type: GameRuntimeCue['type']): GameRuntimeCue {
  return { id, type, atMs: 0 }
}

// Render + synchronously flush effects/rerenders via preact's act().
function draw(vnode: VNode): void {
  void act(() => {
    render(vnode, host)
  })
}

// Render + let async work (fetches, polls) settle, then flush.
async function drawAsync(vnode: VNode): Promise<void> {
  await act(async () => {
    render(vnode, host)
    await tick()
    await tick()
  })
}

const samplePlayer = {
  id: 'me',
  email: 'me@example.com',
  publicName: 'Knight Main',
  favoriteCardId: 26000000,
  totalGames: 12,
  xp: 60,
  level: 1,
  levelStartGames: 0,
  nextLevelGames: 10,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z'
} as const

let host: HTMLDivElement

function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
}

beforeEach(() => {
  mount()
  document.documentElement.classList.remove('reduce-motion')
  motionMock.animate.mockClear()
  soundMock.playTap.mockClear()
  screensaverMock.cycleDesktopFallingCards.mockClear()
  screensaverMock.screensaverActive.value = null
  screensaverMock.desktopFallingCardsMode.value = 'off'
  rainMock.createElixirRain.mockClear()
  apiMock.getLeaderboard.mockReset()
  apiMock.getActivity.mockReset()
  pixiStub.loadPixi.mockReset()
  pixiStub.loadPixi.mockResolvedValue({ Application: pixiStub.Application, Graphics: pixiStub.Graphics })
  // Default to never-resolving so the structural DesktopAside tests leave the
  // aside's module-level standings/activity signals untouched — the aside's
  // data-state tests below rely on those starting empty.
  apiMock.getLeaderboard.mockReturnValue(new Promise(() => {}))
  apiMock.getActivity.mockReturnValue(new Promise(() => {}))
  // Neutralize native Web Animations (tap-fx) so jsdom quirks can't throw.
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = () => ({
    finished: Promise.resolve(),
    cancel: () => {}
  })
  route.value = '/'
  apiAvailability.value = 'available'
  transportOffline.value = false
  offlineRunMode.value = null
  player.value = null
  accountStatus.value = 'anonymous'
  layout.value = 'mobile'
  keyboardHelpOpen.value = false
})

describe('MultipleChoice keyboard input', () => {
  it('binds the advertised home row to the offered cost, not its position', () => {
    const onPick = vi.fn()
    draw(<MultipleChoice choices={[3, 4, 5, 6]} onPick={onPick} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ' }))
    expect(onPick).toHaveBeenCalledWith(6)
    expect(host.querySelector('[aria-label^="6 elixir"] .mc-choices__shortcut')?.textContent).toBe('J')
  })
})

afterEach(() => {
  render(null, host)
  host.remove()
  document.documentElement.classList.remove('reduce-motion')
})

// --- PipKeypad ------------------------------------------------------------

describe('PipKeypad', () => {
  it('renders one key per catalog elixir cost (1..9) and click calls onPick', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)
    const keys = host.querySelectorAll('button[data-pip-value]')
    expect(keys.length).toBe(9)

    host.querySelector<HTMLButtonElement>('[data-pip-value="3"]')!.click()
    expect(onPick).toHaveBeenCalledWith(3, expect.objectContaining({ inputAt: expect.any(Number), trusted: false }))
  })

  it('accepts a primary touch on pointerdown without double-answering its compatibility click', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)
    const key = host.querySelector<HTMLButtonElement>('[data-pip-value="6"]')!

    key.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenLastCalledWith(6, expect.objectContaining({ inputKind: 'pointer', trusted: false }))

    // iOS normally follows the pointer sequence with a synthetic click. The
    // answer must not be recorded a second time when that click does arrive.
    key.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1 }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('answers on a digit keydown', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }))
    expect(onPick).toHaveBeenCalledWith(4, expect.objectContaining({ inputKind: 'keyboard', trusted: false }))
  })

  it('answers with the advertised home-row mapping and renders its labels', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ' }))
    expect(onPick).toHaveBeenCalledWith(6, expect.objectContaining({ inputKind: 'keyboard', trusted: false }))
    expect(host.querySelector('[data-pip-value="6"] .pip-keypad__shortcut')?.textContent).toBe('J')
    expect(host.querySelector('[data-pip-value="9"] .pip-keypad__shortcut')?.textContent).toBe(';')
  })

  it('ignores modifier chords, repeats, out-of-range and typing in inputs', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', repeat: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    expect(onPick).not.toHaveBeenCalled()

    // Typing a digit inside a text field must not answer.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }))
    expect(onPick).not.toHaveBeenCalled()
    input.remove()
  })

  it('suppresses clicks and keys when disabled', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} disabled />)
    const key = host.querySelector<HTMLButtonElement>('[data-pip-value="2"]')!
    expect(key.disabled).toBe(true)
    key.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('removes its window keydown listener on unmount', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)
    render(null, host)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '6' }))
    expect(onPick).not.toHaveBeenCalled()
  })
})

// --- GameFrame ------------------------------------------------------------

describe('GameFrame', () => {
  it('keeps the offline state visible after the countdown', () => {
    offlineRunMode.value = 'surge'
    draw(
      <GameFrame modeName="Surge" counting={false} count={0} onQuit={() => {}} cue={null}>
        <div>Board</div>
      </GameFrame>
    )

    expect(host.querySelector('.ed-game__offline')?.textContent).toBe('Offline · not saved')
  })

  beforeEach(() => {
    // Keep the FX layer inert for these structural tests.
    document.documentElement.classList.add('reduce-motion')
  })

  it('renders the countdown view (no top bar/quit) while counting', () => {
    draw(
      <GameFrame modeName="Surge" counting count={3} onQuit={() => {}} cue={null}>
        <div class="stage-child">stage</div>
      </GameFrame>
    )
    expect(host.querySelector('.ed-game__count')).toBeTruthy()
    expect(host.textContent).toContain('Surge')
    expect(host.textContent).toContain('3')
    expect(host.querySelector('.ed-iconbtn')).toBeNull()
    expect(host.querySelector('.ed-game__top')).toBeNull()
  })

  it('renders the running chrome, progress width, metric, and quit fires onQuit', () => {
    const onQuit = vi.fn()
    draw(
      <GameFrame
        modeName="Survival"
        counting={false}
        count={0}
        onQuit={onQuit}
        cue={null}
        progressText="Card 4 of 15"
        metric={{ value: '18', label: 'streak' }}
        progressPct={40}
        barLow
      >
        <div class="stage-child">stage</div>
      </GameFrame>
    )
    expect(host.querySelector('.ed-game__top')).toBeTruthy()
    expect(host.textContent).toContain('Card 4 of 15')
    expect(host.querySelector('.ed-game__metric')!.textContent).toBe('18')
    expect(host.querySelector('.ed-game__metric-label')!.textContent).toBe('streak')
    const fill = host.querySelector<HTMLElement>('.ed-game__bar-fill')!
    expect(fill.style.width).toBe('40%')
    expect(fill.className).toContain('ed-game__bar-fill--low')
    expect(host.querySelector('.stage-child')).toBeTruthy()

    host.querySelector<HTMLButtonElement>('.ed-iconbtn')!.click()
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  it('requires two Escape presses to abandon an active run', () => {
    const onQuit = vi.fn()
    draw(
      <GameFrame modeName="Surge" counting={false} count={0} onQuit={onQuit} cue={null}>
        <div>stage</div>
      </GameFrame>
    )
    const quit = host.querySelector<HTMLButtonElement>('[aria-label="Abandon run"]')!

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    expect(onQuit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(quit)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  it('clamps progress and applies the full-bleed stage modifier', () => {
    draw(
      <GameFrame modeName="Rain" counting={false} count={0} onQuit={() => {}} cue={null} progressPct={250} fullBleed>
        <div>stage</div>
      </GameFrame>
    )
    expect(host.querySelector<HTMLElement>('.ed-game__bar-fill')!.style.width).toBe('100%')
    expect(host.querySelector('.ed-game__stage--bleed')).toBeTruthy()
  })
})

// --- FloatingCue ----------------------------------------------------------

describe('FloatingCue', () => {
  it('does not animate for the resting trigger 0 but renders children', () => {
    draw(
      <FloatingCue trigger={0} testId="cue">
        Nice!
      </FloatingCue>
    )
    expect(host.querySelector('[data-testid="cue"]')!.textContent).toContain('Nice!')
    expect(motionMock.animate).not.toHaveBeenCalled()
  })

  it('replays the animation each time the trigger value changes', () => {
    draw(<FloatingCue trigger={1}>+1</FloatingCue>)
    expect(motionMock.animate).toHaveBeenCalledTimes(1)

    draw(<FloatingCue trigger={2}>+1</FloatingCue>)
    expect(motionMock.animate).toHaveBeenCalledTimes(2)
    // It animated the actual cue element.
    expect((motionMock.animate.mock.calls[1] as unknown[])[0]).toBe(host.querySelector('.floating-cue'))
  })

  it('does not re-fire when re-rendered with the same trigger', () => {
    draw(<FloatingCue trigger={5}>hi</FloatingCue>)
    motionMock.animate.mockClear()
    draw(<FloatingCue trigger={5}>hi</FloatingCue>)
    expect(motionMock.animate).not.toHaveBeenCalled()
  })

  it('holds a persistent cue visible after its short entrance', () => {
    draw(
      <FloatingCue trigger={1} persistent>
        Higher than 3
      </FloatingCue>
    )
    expect(motionMock.animate).toHaveBeenCalledWith(
      host.querySelector('.floating-cue'),
      { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] },
      { duration: 0.18, ease: 'easeOut' }
    )
  })
})

// --- GameMotion -----------------------------------------------------------

describe('GameMotion', () => {
  it('mounts children in a preset wrapper without animating on first paint', () => {
    draw(
      <GameMotion contentKey="a" cue={null} preset="pair">
        <span class="motion-child">card</span>
      </GameMotion>
    )
    expect(host.querySelector('.game-motion--pair')).toBeTruthy()
    expect(host.querySelector('.motion-child')).toBeTruthy()
    // First paint: previousContentKey === contentKey, so no enter animation.
    expect(motionMock.animate).not.toHaveBeenCalled()
  })

  it('plays an enter animation on content-key change', () => {
    draw(
      <GameMotion contentKey="a" cue={null}>
        <span>card</span>
      </GameMotion>
    )
    motionMock.animate.mockClear()
    draw(
      <GameMotion contentKey="b" cue={null}>
        <span>card</span>
      </GameMotion>
    )
    expect(motionMock.animate).toHaveBeenCalledTimes(1)
  })

  it('plays a feedback animation for answer cues but ignores non-answer cues', () => {
    draw(
      <GameMotion contentKey="a" cue={null}>
        <span>card</span>
      </GameMotion>
    )
    motionMock.animate.mockClear()

    draw(
      <GameMotion contentKey="a" cue={cue(1, 'answer-wrong')}>
        <span>card</span>
      </GameMotion>
    )
    expect(motionMock.animate).toHaveBeenCalledTimes(1)

    motionMock.animate.mockClear()
    draw(
      <GameMotion contentKey="a" cue={cue(2, 'penalty')}>
        <span>card</span>
      </GameMotion>
    )
    expect(motionMock.animate).not.toHaveBeenCalled()
  })
})

// --- GameFxLayer ----------------------------------------------------------

describe('GameFxLayer', () => {
  it('contains an offline chunk failure during speculative preload', async () => {
    const error = new Error('offline chunk')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pixiStub.loadPixi.mockRejectedValueOnce(error)

    preloadGameFx()
    await tick()

    expect(warn).toHaveBeenCalledWith('Optional game effects could not preload', error)
    warn.mockRestore()
  })

  it('lazily mounts the pixi canvas and survives cue changes', async () => {
    draw(<GameFxLayer cue={null} particleCount={8} />)
    expect(host.querySelector('.game-fx-layer')).toBeTruthy()

    await tick()
    await tick()
    const canvas = host.querySelector('canvas.game-fx-layer__canvas')
    expect(canvas).toBeTruthy()

    // A correct then wrong cue spawn bursts through the runtime without throwing.
    expect(() => draw(<GameFxLayer cue={cue(1, 'answer-correct')} particleCount={8} />)).not.toThrow()
    expect(() => draw(<GameFxLayer cue={cue(2, 'answer-wrong')} particleCount={8} />)).not.toThrow()
    expect(host.querySelector('canvas.game-fx-layer__canvas')).toBeTruthy()
  })

  it('is inert under reduced motion (no canvas)', async () => {
    document.documentElement.classList.add('reduce-motion')
    draw(<GameFxLayer cue={cue(1, 'answer-correct')} />)
    await tick()
    expect(host.querySelector('canvas')).toBeNull()
    expect(host.querySelector('.game-fx-layer')).toBeTruthy()
  })
})

// --- MobileShell ----------------------------------------------------------

describe('MobileShell', () => {
  it('renders the bottom pill nav with the active item reflecting the route', () => {
    route.value = '/leaderboards'
    draw(
      <MobileShell>
        <p class="page">home</p>
      </MobileShell>
    )
    const nav = host.querySelector('.ed-pillnav')
    expect(nav).toBeTruthy()
    expect(host.querySelector('.page')).toBeTruthy()

    const buttons = host.querySelectorAll<HTMLButtonElement>('.ed-pillnav__btn')
    expect(buttons.length).toBe(3)
    // Ranks (index 1) is active for a /leaderboards route.
    expect(buttons[1]!.getAttribute('aria-current')).toBe('page')
    expect(host.querySelector<HTMLElement>('.ed-pillnav__ind')!.style.transform).toBe('translateX(100%)')
  })

  it('navigates when a nav item is tapped', () => {
    route.value = '/'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )
    const ladder = [...host.querySelectorAll<HTMLButtonElement>('.ed-pillnav__btn')].find((b) =>
      b.textContent?.includes('Ladder')
    )!
    ladder.click()
    expect(window.location.hash).toBe('#/leaderboards')
  })

  it('keeps the same Play · Ladder · You tabs when disconnected — the nav never renames itself', () => {
    transportOffline.value = true
    route.value = '/profile'
    draw(
      <MobileShell>
        <p>offline</p>
      </MobileShell>
    )

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.ed-pillnav__btn')]
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Play', 'Ladder', 'You'])
    // You (index 2) is still active for a /profile route; offline names its cause
    // with a header chip on the page, not by rewriting a tab.
    expect(buttons[2]!.getAttribute('aria-current')).toBe('page')
  })

  it('hides the nav on game routes for full-bleed play', () => {
    route.value = '/surge'
    draw(
      <MobileShell>
        <p>playing</p>
      </MobileShell>
    )
    expect(host.querySelector('.ed-pillnav')).toBeNull()
    expect(host.querySelector('.ed-mobile__scroll--game')).toBeTruthy()
  })

  it('renders a fixed desktop shell over the advanced Falling Cards scene', async () => {
    layout.value = 'desktop'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )

    expect(host.querySelector('.ed-desktop')).toBeTruthy()
    expect(host.querySelector('.ed-desktop__rail')).toBeTruthy()
    expect(host.querySelector('.ed-aside')).toBeTruthy()
    expect(host.querySelector('.ed-wallpaper')).toBeTruthy()
    expect(host.querySelector('.ed-pillnav')).toBeNull()
    // No key-mapping block in the rail: it teaches a mapping on a screen where
    // it cannot be used. The keycap letters mid-run are the whole surface.
    expect(host.textContent).not.toContain('Speed keys')
    expect(host.querySelector('.ed-desktop-keys')).toBeNull()
    await act(async () => {
      await tick()
    })
    expect(rainMock.createElixirRain).toHaveBeenCalledTimes(1)
  })

  it('keeps Falling Cards behind desktop gameplay while removing the rails', () => {
    layout.value = 'desktop'
    route.value = '/surge'
    draw(
      <MobileShell>
        <p>playing</p>
      </MobileShell>
    )

    expect(host.querySelector('.ed-desktop--game')).toBeTruthy()
    expect(host.querySelector('.ed-wallpaper')).toBeTruthy()
    expect(host.querySelector('.ed-desktop__rail')).toBeNull()
    expect(host.querySelector('.ed-aside')).toBeNull()
  })

  it('keeps one paused desktop Falling Cards scene while it is off', async () => {
    layout.value = 'desktop'
    screensaverMock.desktopFallingCardsMode.value = 'off'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )

    await act(async () => {
      await tick()
    })
    expect(host.querySelector('.ed-wallpaper--off')).toBeTruthy()
    expect(rainMock.createElixirRain).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ enabled: false })
    )
  })

  it('renders the Subtle Falling Cards strength without pausing the scene', async () => {
    layout.value = 'desktop'
    screensaverMock.desktopFallingCardsMode.value = 'subtle'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )

    await act(async () => {
      await tick()
    })
    expect(host.querySelector('.ed-wallpaper--subtle')).toBeTruthy()
    expect(rainMock.createElixirRain).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ enabled: true })
    )
  })

  it('hides the desktop panels without unmounting the Falling Cards host', () => {
    layout.value = 'desktop'
    screensaverMock.screensaverActive.value = 'nav'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )

    expect(host.querySelector('.ed-app--screensaver')).toBeTruthy()
    expect(host.querySelector('.ed-desktop')).toBeTruthy()
    expect(host.querySelector('.ed-wallpaper')).toBeTruthy()
  })

  it('opens and closes the advertised keyboard guide with ? and Escape', async () => {
    layout.value = 'desktop'
    draw(
      <MobileShell>
        <p>home</p>
      </MobileShell>
    )

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true }))
      await Promise.resolve()
    })
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Keep both hands home')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
      await Promise.resolve()
    })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})

// --- DesktopNav (left rail: everything ABOUT the app) ---------------------

describe('DesktopNav', () => {
  it('launches the Falling Cards screensaver from the rail foot', () => {
    draw(<DesktopNav />)
    const saver = host.querySelector<HTMLButtonElement>('.ed-rail-foot .ed-rail-btn--saver')!
    expect(saver).toBeTruthy()
    saver.click()
    expect(screensaverMock.cycleDesktopFallingCards).toHaveBeenCalledTimes(1)
  })

  it('advertises the Subtle scene when Falling Cards are off', () => {
    screensaverMock.desktopFallingCardsMode.value = 'off'
    draw(<DesktopNav />)

    const saver = host.querySelector<HTMLButtonElement>('[aria-label="Falling Cards — subtle"]')!
    expect(saver.textContent).toContain('Subtle →')
    saver.click()
    expect(screensaverMock.cycleDesktopFallingCards).toHaveBeenCalledTimes(1)
  })

  it('offers Background after the Subtle Falling Cards strength', () => {
    screensaverMock.desktopFallingCardsMode.value = 'subtle'
    draw(<DesktopNav />)

    const saver = host.querySelector<HTMLButtonElement>('[aria-label="Falling Cards — background"]')!
    expect(saver.textContent).toContain('Background →')
  })

  it('carries the meta links at the foot and no key-mapping block', () => {
    draw(<DesktopNav />)
    const meta = [...host.querySelectorAll<HTMLAnchorElement>('.ed-rail-meta a')]
    expect(meta.map((link) => link.textContent)).toEqual(['About', 'FAQ', 'Fair Play', 'Privacy'])
    expect(host.querySelector('.ed-desktop-keys')).toBeNull()
    expect(host.textContent).not.toContain('Speed keys')
  })
})

// --- DesktopAside (desktop activity rail) ---------------------------------

describe('DesktopAside', () => {
  it('keeps only the live feed — nothing the page beside it already says', () => {
    draw(<DesktopAside />)
    // Season standings is a board one click away, "Your Surge season" is the
    // hero's own rank-and-best line, and the meta links are reference rather
    // than activity. A rail that repeats the page beside it reads busier AND
    // emptier. The Falling Cards control went to the left rail's foot.
    expect(host.querySelector('.ed-rail-standings')).toBeNull()
    expect(host.querySelector('.ed-rail-this')).toBeNull()
    expect(host.querySelector('.ed-railfoot')).toBeNull()
    expect(host.querySelector('.ed-rail-btn--saver')).toBeNull()
    expect(host.textContent).not.toContain('Season standings')
    expect(host.querySelector('.ed-rail-live')).toBeTruthy()
    expect(host.textContent).toContain('Live · recent runs')
  })
})

// --- DesktopAside (data-state branches) -----------------------------------
// The aside keeps the activity feed in a module-level signal that cannot be
// reset between tests, so these run in order against a single instance: loading
// (pending, the signal stays null) → empty feed → populated.

describe('DesktopAside data states', () => {
  it('replaces live-data spinners and polling with an offline state', () => {
    apiAvailability.value = 'unavailable'
    player.value = { ...samplePlayer }

    draw(<DesktopAside />)

    expect(host.textContent).toContain('Offline — reconnect for recent runs.')
    expect(host.textContent).not.toContain('Loading…')
    expect(apiMock.getActivity).not.toHaveBeenCalled()
  })

  it('shows loading placeholders while requests are in flight', () => {
    // Defaults (from beforeEach) are never-resolving promises.
    draw(<DesktopAside />)
    expect(host.textContent).toContain('Loading…')
    expect(host.querySelector('.ed-rail-block__title')!.textContent).toContain('Live · recent runs')
  })

  it('shows an empty recent-runs feed', async () => {
    apiMock.getActivity.mockReset()
    apiMock.getActivity.mockResolvedValue({ entries: [] })

    await drawAsync(<DesktopAside />)
    expect(host.textContent).toContain('No recent runs yet')
  })

  it('gives the feed ten rows and sends a row to that player', async () => {
    apiMock.getActivity.mockReset()
    apiMock.getActivity.mockResolvedValue({
      entries: [
        {
          mode: 'surge',
          score: 17_260,
          achievedAt: new Date().toISOString(),
          runCount: 8,
          player: { id: 'rival', publicName: 'Rival', favoriteCardId: 26000000 }
        }
      ]
    })
    player.value = { ...samplePlayer }

    await drawAsync(<DesktopAside />)

    // Ten rows: the feed is the only thing in this column and stretches to it.
    expect(apiMock.getActivity).toHaveBeenCalledWith(10, expect.anything())
    expect(host.querySelector('.ed-rail-live__row')).toBeTruthy()
    expect(host.textContent).toContain('Live · recent runs')
    expect(host.textContent).toContain('Surge · 8 runs · best 17.260s')

    host.querySelector<HTMLButtonElement>('.ed-rail-live__row')!.click()
    expect(window.location.hash).toBe('#/players/rival')
  })
})
