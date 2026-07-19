import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIdleWatcher,
  IDLE_ATTRACT_MS,
  LOGO_TAP_WINDOW_MS,
  registerLogoTap,
  resetScreensaverForTests,
  screensaverActive,
  startScreensaver,
  stopScreensaver
} from '../../src/lib/screensaver'

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
