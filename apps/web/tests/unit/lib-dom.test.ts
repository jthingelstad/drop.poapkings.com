import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { tapFx, tapFxFrom } from '../../src/lib/tap-fx'
import {
  applyReducedMotion,
  isReducedMotionEnabled,
  isEnhancedEffectsEnabled,
  initReducedMotion
} from '../../src/lib/motion'
import { navigate, back, parseHash, route } from '../../src/lib/router'
import { track, mirrorFunnel } from '../../src/lib/analytics'
import {
  gameDisplay,
  scoreLabel,
  betterScore,
  scoreFromRecords,
  bestScoresFromRuns,
  LOWER_IS_BETTER
} from '../../src/lib/game-metadata'
import { tradeSummaryLine } from '../../src/lib/mode-insights'
import { saveSettings, getFunnel } from '../../src/lib/storage'
import type { Records } from '../../src/types'
import type { GameMode } from '@elixir-drop/contracts'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAudioCtx(state: AudioContextState = 'running') {
  const osc = {
    type: '' as OscillatorType,
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn(),
    stop: vi.fn()
  }
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn()
  }
  return {
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    state,
    _osc: osc,
    _gain: gain
  }
}

async function loadSound(state: AudioContextState = 'running') {
  vi.resetModules()
  const ctx = makeAudioCtx(state)
  // Called via `new`, so ensure the constructed instance shares ctx's spies.
  const AC = vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, ctx)
    return ctx
  })
  vi.stubGlobal('AudioContext', AC)
  const mod = await import('../../src/lib/sound')
  return { mod, ctx, AC }
}

function makeMql(matches: boolean, opts: { modern?: boolean } = {}) {
  const modern = opts.modern ?? true
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql: Record<string, unknown> = {
    matches,
    media: '',
    fire(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb({ matches: next }))
    }
  }
  if (modern) {
    mql.addEventListener = (_t: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb)
    mql.removeEventListener = (_t: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb)
  } else {
    mql.addListener = (cb: (e: { matches: boolean }) => void) => listeners.add(cb)
    mql.removeListener = (cb: (e: { matches: boolean }) => void) => listeners.delete(cb)
  }
  return mql
}

async function loadLayout(matches: boolean, opts: { modern?: boolean } = {}) {
  vi.resetModules()
  const mql = makeMql(matches, opts)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql)
  )
  const mod = await import('../../src/lib/use-layout')
  return { mod, mql }
}

async function loadPwa() {
  vi.resetModules()
  return await import('../../src/lib/pwa-install')
}

function defineNav(prop: string, value: unknown) {
  Object.defineProperty(window.navigator, prop, { value, configurable: true })
}

// ── sound.ts ──────────────────────────────────────────────────────────────────

describe('sound', () => {
  beforeEach(() => {
    defineNav('vibrate', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('reduce-motion')
  })

  it('creates no audio nodes when sound is disabled (default)', async () => {
    const { mod, ctx, AC } = await loadSound()
    mod.playCorrect()
    expect(AC).not.toHaveBeenCalled()
    expect(ctx.createOscillator).not.toHaveBeenCalled()
  })

  it('synthesizes a blip once sound is enabled', async () => {
    const { mod, ctx, AC } = await loadSound()
    mod.setSoundEnabled(true)
    mod.playCorrect()
    expect(AC).toHaveBeenCalledTimes(1)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(ctx.createGain).toHaveBeenCalledTimes(1)
    expect(ctx._osc.frequency.setValueAtTime).toHaveBeenCalled()
    expect(ctx._osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalled()
    expect(ctx._osc.start).toHaveBeenCalled()
    expect(ctx._osc.stop).toHaveBeenCalled()
    expect(ctx._osc.type).toBe('sine')
  })

  it('initSound reads the persisted sound setting', async () => {
    saveSettings({ sound: true })
    const { mod, ctx } = await loadSound()
    mod.initSound()
    mod.playTap()
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(ctx._osc.type).toBe('triangle')
  })

  it('plays every variant and fires haptics for the tactile ones', async () => {
    const vibrate = vi.fn()
    defineNav('vibrate', vibrate)
    const { mod, ctx } = await loadSound()
    mod.setSoundEnabled(true)
    mod.playCorrect()
    mod.playWrong()
    mod.playTap()
    mod.playCountdownTick()
    mod.playGo()
    mod.playRainClear()
    mod.playRainMiss()
    // 7 play functions each produce exactly one oscillator.
    expect(ctx.createOscillator).toHaveBeenCalledTimes(7)
    // playCountdownTick has no haptic; the other six vibrate.
    expect(vibrate).toHaveBeenCalledTimes(6)
    expect(vibrate).toHaveBeenCalledWith(12) // playCorrect
    expect(vibrate).toHaveBeenCalledWith([10, 40, 14]) // playWrong
  })

  it('resumes a suspended context', async () => {
    const { mod, ctx } = await loadSound('suspended')
    mod.setSoundEnabled(true)
    mod.playGo()
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('does not vibrate under reduced motion (but still no sound when disabled)', async () => {
    const vibrate = vi.fn()
    defineNav('vibrate', vibrate)
    document.documentElement.classList.add('reduce-motion')
    const { mod, ctx } = await loadSound()
    mod.playCorrect() // sound disabled + reduced motion
    expect(vibrate).not.toHaveBeenCalled()
    expect(ctx.createOscillator).not.toHaveBeenCalled()
  })
})

// ── tap-fx.ts ─────────────────────────────────────────────────────────────────

describe('tap-fx', () => {
  let animateSpy: ReturnType<typeof vi.fn>

  function mountButton(): HTMLElement {
    const btn = document.createElement('button')
    const face = document.createElement('span')
    face.className = 'tap-face'
    btn.appendChild(face)
    document.body.appendChild(btn)
    return btn
  }

  beforeEach(() => {
    animateSpy = vi.fn(() => ({ finished: Promise.resolve() }))
    ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = animateSpy
  })

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
    document.body.innerHTML = ''
    document.documentElement.classList.remove('reduce-motion')
  })

  it('spawns spring + ring + spray nodes and cleans them up', async () => {
    const btn = mountButton()
    tapFx(btn)
    // spring(face) + ring + 6 drops = 8 animate calls
    expect(animateSpy).toHaveBeenCalledTimes(8)
    // .tap-face + ring + 6 drops mounted synchronously
    expect(btn.children.length).toBe(8)
    // let the finished promises resolve and remove the transient nodes
    await new Promise((r) => setTimeout(r, 0))
    expect(btn.children.length).toBe(1)
    expect(btn.querySelector('.tap-face')).not.toBeNull()
  })

  it('is a hard no-op under reduced motion', () => {
    document.documentElement.classList.add('reduce-motion')
    const btn = mountButton()
    tapFx(btn)
    expect(animateSpy).not.toHaveBeenCalled()
    expect(btn.children.length).toBe(1)
  })

  it('ignores a null target', () => {
    tapFx(null)
    tapFx(undefined)
    expect(animateSpy).not.toHaveBeenCalled()
  })

  it('tapFxFrom animates the currentTarget element and ignores non-elements', () => {
    const btn = mountButton()
    tapFxFrom({ currentTarget: btn })
    expect(animateSpy).toHaveBeenCalled()
    animateSpy.mockClear()
    tapFxFrom({ currentTarget: null })
    tapFxFrom({} as { currentTarget?: EventTarget | null })
    expect(animateSpy).not.toHaveBeenCalled()
  })
})

// ── motion.ts ─────────────────────────────────────────────────────────────────

describe('motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('reduce-motion')
  })

  it('applyReducedMotion toggles the root class and isReducedMotionEnabled reflects it', () => {
    applyReducedMotion(true)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
    expect(isReducedMotionEnabled()).toBe(true)
    applyReducedMotion(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false)
  })

  it('isReducedMotionEnabled honors the OS media query when no root class', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    )
    expect(isReducedMotionEnabled()).toBe(true)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    )
    expect(isReducedMotionEnabled()).toBe(false)
  })

  it('isEnhancedEffectsEnabled: reduced motion always wins', () => {
    applyReducedMotion(true)
    expect(isEnhancedEffectsEnabled()).toBe(false)
  })

  it('isEnhancedEffectsEnabled: default on, respects the setting', () => {
    applyReducedMotion(false)
    expect(isEnhancedEffectsEnabled()).toBe(true) // default true
    saveSettings({ enhancedEffects: false })
    expect(isEnhancedEffectsEnabled()).toBe(false)
  })

  it('initReducedMotion applies the persisted setting', () => {
    saveSettings({ reducedMotion: true })
    initReducedMotion()
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
  })
})

// ── router.ts ─────────────────────────────────────────────────────────────────

describe('router', () => {
  function fireHashChange() {
    window.dispatchEvent(new Event('hashchange'))
  }

  it('parseHash normalizes root forms and strips the leading #', () => {
    window.location.hash = ''
    expect(parseHash()).toBe('/')
    window.location.hash = '#'
    expect(parseHash()).toBe('/')
    window.location.hash = '#/'
    expect(parseHash()).toBe('/')
    window.location.hash = '#/foo'
    expect(parseHash()).toBe('/foo')
  })

  it('navigate updates the hash and route signal on hashchange', () => {
    navigate('/surge')
    fireHashChange()
    expect(window.location.hash).toBe('#/surge')
    expect(route.value).toBe('/surge')
  })

  it('navigate to the current route is a no-op scroll', () => {
    window.location.hash = '#/here'
    const scroll = window.scrollTo as unknown as ReturnType<typeof vi.fn>
    scroll.mockClear()
    navigate('/here') // parseHash already '/here'
    expect(scroll).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/here')
  })

  it('back returns to the previous route', () => {
    navigate('/a')
    fireHashChange()
    navigate('/b')
    fireHashChange()
    expect(route.value).toBe('/b')
    back()
    fireHashChange()
    expect(route.value).toBe('/a')
  })
})

// ── analytics.ts ──────────────────────────────────────────────────────────────

describe('analytics', () => {
  afterEach(() => {
    delete (window as { tinylytics?: unknown }).tinylytics
  })

  it('track works with no tinylytics global present', () => {
    delete (window as { tinylytics?: unknown }).tinylytics
    expect(() => track('game.start')).not.toThrow()
  })

  it('track nudges the tinylytics embed when present', () => {
    const triggerUpdate = vi.fn()
    ;(window as { tinylytics?: unknown }).tinylytics = { triggerUpdate }
    track('surge.complete')
    expect(triggerUpdate).toHaveBeenCalled()
  })

  it('mirrorFunnel increments the funnel-relevant counters only', () => {
    mirrorFunnel('recruit.shown')
    mirrorFunnel('recruit.join')
    mirrorFunnel('recruit.discord')
    mirrorFunnel('result.share')
    mirrorFunnel('game.start') // not a funnel event
    const f = getFunnel()
    expect(f.recruitShown).toBe(1)
    expect(f.recruitJoin).toBe(1)
    expect(f.recruitDiscord).toBe(1)
    expect(f.shares).toBe(1)
  })
})

// ── game-metadata.ts ──────────────────────────────────────────────────────────

describe('game-metadata', () => {
  it('gameDisplay returns name + icon for every mode incl. rain', () => {
    expect(gameDisplay('surge')).toEqual({ name: 'Surge', icon: '⚡' })
    expect(gameDisplay('practice').name).toBe('Practice')
    expect(gameDisplay('higher-lower').name).toBe('Higher / Lower')
    expect(gameDisplay('trade')).toEqual({ name: 'Trade', icon: '👑' })
    expect(gameDisplay('survival').icon).toBe('💀')
    expect(gameDisplay('rain')).toEqual({ name: 'Rain', icon: '🌧️' })
  })

  it('scoreLabel formats per mode', () => {
    expect(scoreLabel('surge', 12340)).toBe('12.34s') // lower-is-better
    expect(scoreLabel('trade', 5000)).toBe('5.00s') // lower-is-better
    expect(scoreLabel('practice', 87.4)).toBe('87%')
    expect(scoreLabel('rain', 9.6)).toBe('10 cleared')
    expect(scoreLabel('higher-lower', 12)).toBe('12 streak')
    expect(scoreLabel('survival', 8)).toBe('8 streak')
  })

  it('LOWER_IS_BETTER holds only the golf-time modes', () => {
    expect(LOWER_IS_BETTER.has('surge')).toBe(true)
    expect(LOWER_IS_BETTER.has('trade')).toBe(true)
    expect(LOWER_IS_BETTER.has('survival')).toBe(false)
  })

  it('betterScore respects direction and the undefined-current case', () => {
    expect(betterScore('surge', 100, undefined)).toBe(true)
    expect(betterScore('surge', 100, 200)).toBe(true) // lower wins
    expect(betterScore('surge', 300, 200)).toBe(false)
    expect(betterScore('survival', 10, 5)).toBe(true) // higher wins
    expect(betterScore('survival', 3, 5)).toBe(false)
  })

  it('scoreFromRecords reads the mode record key', () => {
    const records: Records = { surgeBest: 4200, survivalBest: 14 }
    expect(scoreFromRecords('surge', records)).toBe(4200)
    expect(scoreFromRecords('survival', records)).toBe(14)
    expect(scoreFromRecords('trade', records)).toBeUndefined()
  })

  it('bestScoresFromRuns picks the best per mode and honors the season filter', () => {
    const runs: Array<{ mode: GameMode; score: number; seasonId: string }> = [
      { mode: 'surge', score: 5000, seasonId: 's1' },
      { mode: 'surge', score: 4000, seasonId: 's1' }, // better (lower)
      { mode: 'survival', score: 8, seasonId: 's1' },
      { mode: 'survival', score: 12, seasonId: 's2' } // filtered out below
    ]
    const all = bestScoresFromRuns(runs)
    expect(all.surge).toBe(4000)
    expect(all.survival).toBe(12) // higher wins across all seasons
    const s1 = bestScoresFromRuns(runs, 's1')
    expect(s1.surge).toBe(4000)
    expect(s1.survival).toBe(8)
  })
})

// ── mode-insights.ts ──────────────────────────────────────────────────────────

describe('mode-insights: tradeSummaryLine', () => {
  const base = { totalMs: 12000, sequenceLen: 5, cleanTrades: 5, wrongGuesses: 0, lastTrade: 0 }

  it('leads with the PB line', () => {
    const line = tradeSummaryLine({ ...base, isPB: true })
    expect(line).toContain('New Trade best')
    expect(line).toContain('12.00s')
  })

  it('celebrates a clean sweep', () => {
    const line = tradeSummaryLine({ ...base, isPB: false, wrongGuesses: 0 })
    expect(line).toBe('5/5 clean. You read both bars without a hint.')
  })

  it('warns on a negative last trade', () => {
    const line = tradeSummaryLine({ ...base, isPB: false, wrongGuesses: 2, cleanTrades: 3, lastTrade: -2 })
    expect(line).toContain('Watch the sign')
    expect(line.startsWith('3/5 clean')).toBe(true)
  })

  it('explains a positive last trade with a formatted value', () => {
    const line = tradeSummaryLine({ ...base, isPB: false, wrongGuesses: 1, cleanTrades: 4, lastTrade: 3 })
    expect(line).toContain('Red overspent')
    expect(line).toContain('+3')
  })

  it('handles an even last trade with misses', () => {
    const line = tradeSummaryLine({ ...base, isPB: false, wrongGuesses: 1, cleanTrades: 4, lastTrade: 0 })
    expect(line).toContain('Even trades')
  })
})

// ── use-layout.ts ─────────────────────────────────────────────────────────────

describe('use-layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects desktop above the breakpoint', async () => {
    const { mod } = await loadLayout(true)
    expect(mod.layout.value).toBe('desktop')
    expect(mod.isDesktop()).toBe(true)
  })

  it('detects mobile below the breakpoint and reacts to a change event', async () => {
    const { mod, mql } = await loadLayout(false)
    expect(mod.layout.value).toBe('mobile')
    expect(mod.isDesktop()).toBe(false)
    ;(mql as unknown as { fire: (m: boolean) => void }).fire(true)
    expect(mod.layout.value).toBe('desktop')
    ;(mql as unknown as { fire: (m: boolean) => void }).fire(false)
    expect(mod.layout.value).toBe('mobile')
  })

  it('falls back to the legacy addListener signature', async () => {
    const { mod, mql } = await loadLayout(false, { modern: false })
    expect(mod.layout.value).toBe('mobile')
    ;(mql as unknown as { fire: (m: boolean) => void }).fire(true)
    expect(mod.layout.value).toBe('desktop')
  })
})

// ── pwa-install.ts ────────────────────────────────────────────────────────────

describe('pwa-install', () => {
  const origUA = window.navigator.userAgent
  const origPlatform = window.navigator.platform

  afterEach(() => {
    vi.unstubAllGlobals()
    defineNav('userAgent', origUA)
    defineNav('platform', origPlatform)
    defineNav('standalone', undefined)
    defineNav('maxTouchPoints', 0)
  })

  function stubMatchMedia(standalone: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q.includes('display-mode: standalone') ? standalone : false,
        addEventListener: () => {},
        removeEventListener: () => {}
      }))
    )
  }

  it('captures beforeinstallprompt → available, then promptInstall consumes it', async () => {
    stubMatchMedia(false)
    defineNav('userAgent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120')
    defineNav('standalone', undefined)
    const mod = await loadPwa()
    expect(mod.installMode.value).toBe('none')
    mod.initInstallPrompt()

    const evt = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string }>
    }
    evt.prompt = vi.fn(() => Promise.resolve())
    evt.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(evt)
    expect(mod.installMode.value).toBe('available')

    await mod.promptInstall()
    expect(evt.prompt).toHaveBeenCalled()
    expect(mod.installMode.value).toBe('none')

    // deferred is now cleared → a second prompt is a no-op
    await expect(mod.promptInstall()).resolves.toBeUndefined()
  })

  it('appinstalled resets install mode to none', async () => {
    stubMatchMedia(false)
    defineNav('userAgent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120')
    const mod = await loadPwa()
    mod.initInstallPrompt()

    const evt = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string }>
    }
    evt.prompt = vi.fn(() => Promise.resolve())
    evt.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(evt)
    expect(mod.installMode.value).toBe('available')

    window.dispatchEvent(new Event('appinstalled'))
    expect(mod.installMode.value).toBe('none')
  })

  it('does nothing when already running standalone', async () => {
    stubMatchMedia(true) // display-mode: standalone matches
    const mod = await loadPwa()
    mod.initInstallPrompt()
    // no listener registered → a beforeinstallprompt does not flip the mode
    window.dispatchEvent(new Event('beforeinstallprompt'))
    expect(mod.installMode.value).toBe('none')
  })

  it('surfaces the iOS hint on iOS Safari', async () => {
    stubMatchMedia(false)
    defineNav(
      'userAgent',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    )
    defineNav('standalone', false)
    const mod = await loadPwa()
    mod.initInstallPrompt()
    expect(mod.installMode.value).toBe('ios')
  })
})
