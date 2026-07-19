import { signal } from '@preact/signals'
import { track } from './analytics'
import { isReducedMotionEnabled } from './motion'

// "Elixir Rain" activation state. Three doors in: the nav launcher (a visible
// feature now, not only an egg), five quick taps on the hero logo, or two idle
// minutes on Home. Any input exits. Under reduced motion it simply does not run.

export type ScreensaverSource = 'tap' | 'idle' | 'nav'

export const screensaverActive = signal<ScreensaverSource | null>(null)

export const LOGO_TAP_COUNT = 5
export const LOGO_TAP_WINDOW_MS = 1500
export const IDLE_ATTRACT_MS = 120_000

let tapCount = 0
let lastTapAt = 0

export function startScreensaver(source: ScreensaverSource): void {
  if (screensaverActive.value || isReducedMotionEnabled()) return
  screensaverActive.value = source
  // Only deliberate opens (nav launcher, logo taps) are worth counting; idle
  // attract would just tally abandoned tabs.
  if (source !== 'idle') track('egg.screensaver')
}

export function stopScreensaver(): void {
  screensaverActive.value = null
}

// Wired to the ELIXIR DROP hero logo. `now` is injectable for tests.
export function registerLogoTap(now = Date.now()): void {
  tapCount = now - lastTapAt <= LOGO_TAP_WINDOW_MS ? tapCount + 1 : 1
  lastTapAt = now
  if (tapCount >= LOGO_TAP_COUNT) {
    tapCount = 0
    startScreensaver('tap')
  }
}

export function resetScreensaverForTests(): void {
  tapCount = 0
  lastTapAt = 0
  screensaverActive.value = null
}

// Idle attract watcher. The caller arms it only on the Home route; it refuses
// to fire while the tab is hidden, reduced motion is on, or a top-layer
// <dialog> (Trophy Road) is open — the top layer paints above any z-index.
export function createIdleWatcher(onIdle: () => void, idleMs = IDLE_ATTRACT_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (document.visibilityState !== 'visible') return
    if (isReducedMotionEnabled()) return
    if (document.querySelector('dialog[open]')) return
    onIdle()
  }
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(fire, idleMs)
  }
  const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const
  for (const event of events) window.addEventListener(event, arm, { passive: true, capture: true })
  document.addEventListener('visibilitychange', arm)
  arm()
  return () => {
    clearTimeout(timer)
    for (const event of events) window.removeEventListener(event, arm, { capture: true })
    document.removeEventListener('visibilitychange', arm)
  }
}
