import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cycleDesktopFallingCards,
  createIdleWatcher,
  desktopFallingCardsMode,
  IDLE_ATTRACT_MS,
  LOGO_TAP_WINDOW_MS,
  registerLogoTap,
  resetScreensaverForTests,
  screensaverActive,
  startScreensaver,
  stopScreensaver
} from '../../src/lib/screensaver'
import { fallingCardsFrameRate, rotateCastWindow } from '../../src/components/ScreensaverScene'

describe('screensaver activation', () => {
  beforeEach(() => {
    resetScreensaverForTests()
    document.documentElement.classList.remove('reduce-motion')
  })

  afterEach(() => {
    vi.useRealTimers()
    resetScreensaverForTests()
    document.documentElement.classList.remove('reduce-motion')
  })

  it('activates after five quick logo taps and resets on a slow gap', () => {
    const start = 1_000_000
    for (let tap = 0; tap < 4; tap += 1) registerLogoTap(start + tap * 200)
    expect(screensaverActive.value).toBeNull()

    // A gap past the window resets the count — the fifth slow tap is tap one.
    registerLogoTap(start + 4 * 200 + LOGO_TAP_WINDOW_MS + 1)
    expect(screensaverActive.value).toBeNull()

    const restart = start + 60_000
    for (let tap = 0; tap < 5; tap += 1) registerLogoTap(restart + tap * 200)
    expect(screensaverActive.value).toBe('tap')

    // Idempotent while active.
    startScreensaver('idle')
    expect(screensaverActive.value).toBe('tap')

    stopScreensaver()
    expect(screensaverActive.value).toBeNull()
  })

  it('is a full no-op under reduced motion', () => {
    document.documentElement.classList.add('reduce-motion')
    const start = 2_000_000
    for (let tap = 0; tap < 5; tap += 1) registerLogoTap(start + tap * 100)
    expect(screensaverActive.value).toBeNull()
    startScreensaver('idle')
    expect(screensaverActive.value).toBeNull()
  })

  it('defaults desktop Falling Cards off, then cycles through background and full screen', () => {
    expect(desktopFallingCardsMode.value).toBe('off')

    cycleDesktopFallingCards()
    expect(desktopFallingCardsMode.value).toBe('ambient')
    expect(screensaverActive.value).toBeNull()

    cycleDesktopFallingCards()
    expect(screensaverActive.value).toBe('nav')
    expect(desktopFallingCardsMode.value).toBe('ambient')

    stopScreensaver()
    expect(screensaverActive.value).toBeNull()
    expect(desktopFallingCardsMode.value).toBe('off')

    cycleDesktopFallingCards()
    expect(desktopFallingCardsMode.value).toBe('ambient')
    expect(screensaverActive.value).toBeNull()
  })

  it('cycles a reduced-motion desktop directly between its frozen scene and off', () => {
    document.documentElement.classList.add('reduce-motion')

    cycleDesktopFallingCards()
    expect(desktopFallingCardsMode.value).toBe('ambient')
    expect(screensaverActive.value).toBeNull()

    cycleDesktopFallingCards()
    expect(desktopFallingCardsMode.value).toBe('off')
  })

  it('does not restart the idle attract mode after desktop Falling Cards are off', () => {
    desktopFallingCardsMode.value = 'off'
    startScreensaver('idle')
    expect(screensaverActive.value).toBeNull()
  })

  it('fires the idle watcher after the threshold and re-arms on activity', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const dispose = createIdleWatcher(onIdle)

    vi.advanceTimersByTime(IDLE_ATTRACT_MS - 1_000)
    // Activity re-arms the timer.
    window.dispatchEvent(new Event('pointermove'))
    vi.advanceTimersByTime(IDLE_ATTRACT_MS - 1_000)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(onIdle).toHaveBeenCalledTimes(1)

    dispose()
    vi.advanceTimersByTime(IDLE_ATTRACT_MS * 2)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('refuses to fire while hidden, reduced-motion, or a dialog is open', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()

    // Reduced motion.
    document.documentElement.classList.add('reduce-motion')
    let dispose = createIdleWatcher(onIdle)
    vi.advanceTimersByTime(IDLE_ATTRACT_MS)
    expect(onIdle).not.toHaveBeenCalled()
    dispose()
    document.documentElement.classList.remove('reduce-motion')

    // Open top-layer dialog (Trophy Road).
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.appendChild(dialog)
    dispose = createIdleWatcher(onIdle)
    vi.advanceTimersByTime(IDLE_ATTRACT_MS)
    expect(onIdle).not.toHaveBeenCalled()
    dispose()
    dialog.remove()

    // Hidden tab.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    dispose = createIdleWatcher(onIdle)
    vi.advanceTimersByTime(IDLE_ATTRACT_MS)
    expect(onIdle).not.toHaveBeenCalled()
    dispose()
    visibility.mockRestore()
  })
})

describe('Falling Cards cast rotation', () => {
  it('keeps ambient rendering light while restoring showcase smoothness', () => {
    expect(fallingCardsFrameRate(false)).toBe(20)
    expect(fallingCardsFrameRate(true)).toBe(60)
  })

  it('cycles the whole catalog through one bounded 30-card window', () => {
    const catalog = Array.from({ length: 120 }, (_, index) => `card-${index}`)
    let active = catalog.slice(0, 30)
    let cursor = 30
    const seen = new Set(active)

    for (let rotation = 0; rotation < 15; rotation += 1) {
      const next = rotateCastWindow(catalog, active, cursor)
      active = next.active
      cursor = next.nextCursor
      next.incoming.forEach((card) => seen.add(card))

      expect(active).toHaveLength(30)
      expect(new Set(active).size).toBe(30)
      expect(next.incoming).toHaveLength(6)
      expect(next.retired).toHaveLength(6)
    }

    expect(seen.size).toBe(120)
  })

  it('leaves a bounded cast unchanged when there is nothing safe to rotate', () => {
    const active = ['knight', 'archers']

    expect(rotateCastWindow(active, active, 0)).toEqual({
      active,
      incoming: [],
      retired: [],
      nextCursor: 0
    })
    expect(rotateCastWindow([...active, 'giant'], active, 2, 0)).toEqual({
      active,
      incoming: [],
      retired: [],
      nextCursor: 2
    })
  })
})
