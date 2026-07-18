import { signal } from '@preact/signals'

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
