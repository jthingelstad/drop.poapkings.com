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
  startScreensaver: vi.fn()
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
    ticker = { add: () => {} }
    screen = { width: 300, height: 200 }
    async init() {}
    destroy() {}
  }
  return { Application, Graphics }
})

vi.mock('motion', () => ({ animate: motionMock.animate }))
vi.mock('../../src/lib/sound', () => soundMock)
vi.mock('../../src/lib/screensaver', () => screensaverMock)
vi.mock('../../src/lib/load-pixi', () => ({
  loadPixi: () => Promise.resolve({ Application: pixiStub.Application, Graphics: pixiStub.Graphics })
}))
vi.mock('../../src/lib/api', () => ({
  getLeaderboard: apiMock.getLeaderboard,
  getActivity: apiMock.getActivity
}))

// --- Static imports (original module singletons) --------------------------

import PipKeypad from '../../src/components/PipKeypad'
import GameFrame from '../../src/components/game/GameFrame'
import FloatingCue from '../../src/components/FloatingCue'
import GameMotion from '../../src/components/GameMotion'
import GameFxLayer from '../../src/components/GameFxLayer'
import MobileShell from '../../src/components/shell/MobileShell'
import DesktopShell from '../../src/components/shell/DesktopShell'
import DesktopRightRail from '../../src/components/shell/DesktopRightRail'
import { route } from '../../src/lib/router'
import { player, accountStatus } from '../../src/lib/account'

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
  screensaverMock.startScreensaver.mockClear()
  apiMock.getLeaderboard.mockReset()
  apiMock.getActivity.mockReset()
  // Default to never-resolving so incidental rail mounts (e.g. in DesktopShell
  // tests) leave the rail's module-level standings/activity signals untouched —
  // the DesktopRightRail state tests rely on those starting empty.
  apiMock.getLeaderboard.mockReturnValue(new Promise(() => {}))
  apiMock.getActivity.mockReturnValue(new Promise(() => {}))
  // Neutralize native Web Animations (tap-fx) so jsdom quirks can't throw.
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = () => ({
    finished: Promise.resolve(),
    cancel: () => {}
  })
  route.value = '/'
  player.value = null
  accountStatus.value = 'anonymous'
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
    expect(onPick).toHaveBeenCalledWith(3)
  })

  it('answers on a digit keydown', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }))
    expect(onPick).toHaveBeenCalledWith(4)
  })

  it('ignores modifier chords, repeats, out-of-range and typing in inputs', () => {
    const onPick = vi.fn()
    draw(<PipKeypad onPick={onPick} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', repeat: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
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
    const ranks = [...host.querySelectorAll<HTMLButtonElement>('.ed-pillnav__btn')].find((b) =>
      b.textContent?.includes('Ranks')
    )!
    ranks.click()
    expect(window.location.hash).toBe('#/leaderboards')
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
})

// --- DesktopShell ---------------------------------------------------------

describe('DesktopShell', () => {
  it('shows the guest chip and the about/faq/privacy/discord cluster when signed out', () => {
    accountStatus.value = 'anonymous'
    player.value = null
    draw(
      <DesktopShell>
        <p class="page">stage</p>
      </DesktopShell>
    )
    expect(host.textContent).toContain('Guest')
    expect(host.textContent).not.toContain('Falling Cards')

    const foot = host.querySelector('.ed-railfoot')!
    const labels = [...foot.querySelectorAll('.ed-railfoot__link')].map((l) => l.textContent?.trim())
    expect(labels.some((l) => l?.startsWith('About'))).toBe(true)
    expect(labels.some((l) => l?.startsWith('FAQ'))).toBe(true)
    expect(labels.some((l) => l?.startsWith('Privacy'))).toBe(true)
    const discord = foot.querySelector<HTMLAnchorElement>('a.ed-railfoot__link')!
    expect(discord.href).toBe('https://discord.gg/SdvKfJW5kA')
  })

  it('navigates to login when the guest chip is clicked', () => {
    accountStatus.value = 'anonymous'
    player.value = null
    draw(
      <DesktopShell>
        <p>stage</p>
      </DesktopShell>
    )
    host.querySelector<HTMLButtonElement>('.ed-rail-chip--guest')!.click()
    expect(window.location.hash).toBe('#/login')
  })

  it('shows the player chip + Falling Cards launcher when authed and launches the screensaver', () => {
    accountStatus.value = 'authenticated'
    player.value = { ...samplePlayer }
    draw(
      <DesktopShell>
        <p>stage</p>
      </DesktopShell>
    )
    expect(host.textContent).toContain('Knight Main')
    const saver = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Falling Cards')
    )!
    expect(saver).toBeTruthy()
    saver.click()
    expect(screensaverMock.startScreensaver).toHaveBeenCalledWith('nav')
  })

  it('signs out when the Sign out button is clicked', () => {
    accountStatus.value = 'authenticated'
    player.value = { ...samplePlayer }
    draw(
      <DesktopShell>
        <p>stage</p>
      </DesktopShell>
    )
    const out = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Sign out')
    )!
    out.click()
    expect(accountStatus.value).toBe('anonymous')
    expect(player.value).toBeNull()
  })

  it('marks the nav item matching the current route as the active page', () => {
    route.value = '/leaderboards'
    accountStatus.value = 'anonymous'
    draw(
      <DesktopShell>
        <p>stage</p>
      </DesktopShell>
    )
    const active = [...host.querySelectorAll<HTMLButtonElement>('.ed-nav__item')].find(
      (b) => b.getAttribute('aria-current') === 'page'
    )!
    expect(active.textContent).toContain('Leaderboards')

    const profile = [...host.querySelectorAll<HTMLButtonElement>('.ed-nav__item')].find((b) =>
      b.textContent?.includes('Profile')
    )!
    profile.click()
    expect(window.location.hash).toBe('#/profile')
  })
})

// --- DesktopRightRail (data-state branches) -------------------------------
// The rail keeps standings/activity in module-level signals that cannot be reset
// between tests, so these run in order against a single instance: loading (both
// pending, signals stay null) → failed standings + empty feed (standings stays
// null) → populated (standings resolves truthy for the rest of the file).

describe('DesktopRightRail', () => {
  it('shows loading placeholders while requests are in flight', () => {
    // Defaults (from beforeEach) are never-resolving promises.
    draw(<DesktopRightRail />)
    expect(host.textContent).toContain('Loading…')
    expect(host.querySelector('.ed-rail-block__title')!.textContent).toContain('Season standings')
  })

  it('shows the standings-unavailable message and an empty recent-runs feed', async () => {
    apiMock.getLeaderboard.mockReset()
    apiMock.getActivity.mockReset()
    apiMock.getLeaderboard.mockRejectedValue(new Error('boom'))
    apiMock.getActivity.mockResolvedValue({ entries: [] })

    await drawAsync(<DesktopRightRail />)
    expect(host.textContent).toContain('Standings unavailable')
    expect(host.textContent).toContain('No recent runs yet')
  })

  it('renders populated standings, a "You" row, the season card, and grouped recent runs', async () => {
    apiMock.getLeaderboard.mockReset()
    apiMock.getActivity.mockReset()
    apiMock.getLeaderboard.mockResolvedValue({
      entries: [
        {
          rank: 1,
          score: 1.2,
          achievedAt: new Date().toISOString(),
          player: { id: 'rival', publicName: 'Rival', favoriteCardId: 26000000 }
        },
        {
          rank: 2,
          score: 1.45,
          achievedAt: new Date().toISOString(),
          player: { id: 'me', publicName: 'Me', favoriteCardId: 26000000 }
        }
      ]
    })
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

    await drawAsync(<DesktopRightRail />)

    const rows = host.querySelectorAll('.ed-rail-row')
    expect(rows.length).toBe(2)
    // The signed-in player's row is labelled "You" and highlighted.
    expect(host.querySelector('.ed-rail-row--you')).toBeTruthy()
    expect(host.textContent).toContain('You')
    expect(host.textContent).toContain('Rival')
    // "This season" card shows the player's own rank (#2).
    expect(host.querySelector('.ed-rail-this')).toBeTruthy()
    expect(host.textContent).toContain('#2')
    // The grouped feed renders one compact row with its count and best score.
    expect(host.querySelector('.ed-rail-live__row')).toBeTruthy()
    expect(host.textContent).toContain('Recent runs')
    expect(host.textContent).toContain('Surge · 8 runs · best 17.26s')
    expect(host.textContent).not.toContain('Live now')
    expect(host.querySelector('.ed-rail-live__dot')).toBeNull()
  })
})
