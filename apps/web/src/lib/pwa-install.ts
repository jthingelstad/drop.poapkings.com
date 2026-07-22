// Add-to-Home-Screen prompt state. Android/Chrome fire `beforeinstallprompt`,
// which we capture to power a real Install button. iOS Safari has no such event
// (install is a manual Share → "Add to Home Screen"), so there we surface an
// instructional hint instead. The prompt hides once the app runs standalone or
// the player dismisses it (persisted).

import { signal } from '@preact/signals'
import { track, type TinyEventValue } from './analytics'

export type InstallMode = 'none' | 'available' | 'ios'

const DISMISS_KEY = 'elixirdrop:installDismissed'
const SESSION_COUNT_KEY = 'elixirdrop:installSessionCount'
const SESSION_MARKER_KEY = 'elixirdrop:installSessionCounted'
const ELIGIBLE_SESSION_COUNT = 3

// Capability: whether Drop can be installed here at all ('none' = already
// standalone, or a browser with no install path).
export const installMode = signal<InstallMode>('none')

// Capability and eligibility are intentionally separate. Browsers may expose an
// install path on the first visit, but Drop waits until the third distinct
// browser session before suggesting it on Home.
export const installEligible = signal(false)

// Whether the player dismissed the prominent Home banner. Dismissing does not
// hide install entirely — a compact row stays on Home and the full Install page
// stays in Profile → More. Persisted so the banner doesn't nag on every visit.
export const installDismissed = signal<boolean>(dismissed())

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null

function analyticsValue(mode: InstallMode = installMode.value): TinyEventValue {
  return mode === 'ios' ? 'ios' : 'browser'
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // Exclude in-app browsers / other iOS browsers that can't add to the home screen.
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua)
  return iOS && safari
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function recordBrowserSession(): void {
  try {
    const stored = Number.parseInt(localStorage.getItem(SESSION_COUNT_KEY) || '0', 10)
    let count = Number.isFinite(stored) && stored > 0 ? stored : 0
    if (sessionStorage.getItem(SESSION_MARKER_KEY) !== '1') {
      count += 1
      localStorage.setItem(SESSION_COUNT_KEY, String(count))
      sessionStorage.setItem(SESSION_MARKER_KEY, '1')
    }
    installEligible.value = count >= ELIGIBLE_SESSION_COUNT
  } catch {
    // Storage-disabled browsers keep the install page available from Profile,
    // but do not get a potentially naggy automatic suggestion.
    installEligible.value = false
  }
}

export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return
  recordBrowserSession()
  // Already installed → no install UI at all. A prior dismiss no longer stops
  // capability detection; it only collapses the banner (see installDismissed).
  if (isStandalone()) {
    installEligible.value = false
    return
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    installMode.value = 'available'
  })
  window.addEventListener('appinstalled', () => {
    track('install.completed', analyticsValue())
    deferred = null
    installMode.value = 'none'
    installEligible.value = false
  })

  // iOS has no beforeinstallprompt — offer the manual hint.
  if (isIosSafari()) installMode.value = 'ios'
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return
  const event = deferred
  deferred = null
  installMode.value = 'none'
  try {
    await event.prompt()
    const choice = await event.userChoice
    track(choice.outcome === 'accepted' ? 'install.prompt_accepted' : 'install.prompt_dismissed', 'browser')
  } catch {
    // The prompt can only be used once; nothing to recover.
  }
}

export function dismissInstall(): void {
  track('install.suggestion_dismissed', analyticsValue())
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // ignore — a non-persisted dismiss still collapses it this session
  }
  installDismissed.value = true
}

export function installAnalyticsValue(): TinyEventValue {
  return analyticsValue()
}
