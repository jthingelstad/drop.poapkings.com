import { computed, signal } from '@preact/signals'
import { GAME_MODES } from '@elixir-drop/contracts'

export type ApiAvailability = 'checking' | 'available' | 'unavailable'

export const apiAvailability = signal<ApiAvailability>('checking')
// The transport verdict stays separate from the effective product state. A
// browser may report "online" while airplane mode, captive Wi-Fi, DNS, or the
// player API itself makes every server request unreachable.
export const transportOffline = signal(typeof navigator !== 'undefined' && navigator.onLine === false)

// Every API failure already converges on `apiAvailability`. Make that same
// signal own the offline experience so navigation, local deals, persistence,
// and live-data polling cannot disagree about whether recorded play is safe.
export const offline = computed(() => transportOffline.value || apiAvailability.value === 'unavailable')

export function reportApiAvailable(): void {
  apiAvailability.value = 'available'
}

export function reportApiUnavailable(): void {
  apiAvailability.value = 'unavailable'
}

export function watchConnectivity(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const update = () => {
    transportOffline.value = navigator.onLine === false
  }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  return () => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}

// Every game can deal locally when the browser is definitely offline. The run
// stays unrecorded; signed server challenges remain mandatory for official play.
export function canPlayOffline(mode: string): boolean {
  return GAME_MODES.some((candidate) => candidate === mode)
}
