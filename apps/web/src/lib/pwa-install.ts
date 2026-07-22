// Add-to-Home-Screen prompt state. Android/Chrome fire `beforeinstallprompt`,
// which we capture to power a real Install button. iOS Safari has no such event
// (install is a manual Share → "Add to Home Screen"), so there we surface an
// instructional hint instead. The prompt hides once the app runs standalone or
// the player dismisses it (persisted).

import { signal } from '@preact/signals'

export type InstallMode = 'none' | 'available' | 'ios'

const DISMISS_KEY = 'elixirdrop:installDismissed'

// Capability: whether Drop can be installed here at all ('none' = already
// standalone, or a browser with no install path).
export const installMode = signal<InstallMode>('none')

// Whether the player dismissed the prominent Home banner. Dismissing does not
// hide install entirely — a compact row stays on Home and the full Install page
// stays in Profile → More. Persisted so the banner doesn't nag on every visit.
export const installDismissed = signal<boolean>(dismissed())

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null

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

export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return
  // Already installed → no install UI at all. A prior dismiss no longer stops
  // capability detection; it only collapses the banner (see installDismissed).
  if (isStandalone()) return

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    installMode.value = 'available'
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installMode.value = 'none'
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
    await event.userChoice
  } catch {
    // The prompt can only be used once; nothing to recover.
  }
}

export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // ignore — a non-persisted dismiss still collapses it this session
  }
  installDismissed.value = true
}
