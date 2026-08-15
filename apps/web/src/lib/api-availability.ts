import { signal } from '@preact/signals'
import { GAME_MODES } from '@elixir-drop/contracts'

export type ApiAvailability = 'checking' | 'available' | 'unavailable'
export type ApiUnavailableReason = 'offline' | 'service'

export const apiAvailability = signal<ApiAvailability>('checking')
export const apiUnavailableReason = signal<ApiUnavailableReason>('service')

export function reportApiAvailable(): void {
  apiAvailability.value = 'available'
}

export function reportApiUnavailable(): void {
  apiUnavailableReason.value = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'service'
  apiAvailability.value = 'unavailable'
}

// The browser's own verdict, which arrives immediately rather than after a
// request has already failed. It is only trustworthy in one direction — false
// means definitely offline, true does not promise the API is reachable — and
// that is exactly the direction this is used in: to choose a local run up front
// instead of creating an official attempt that cannot be completed.
export const offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false)

export function watchConnectivity(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const update = () => {
    offline.value = navigator.onLine === false
    // Coming back is worth acting on: the banner's reason should stop saying
    // "offline" the moment the network returns.
    if (!offline.value && apiUnavailableReason.value === 'offline') apiUnavailableReason.value = 'service'
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
