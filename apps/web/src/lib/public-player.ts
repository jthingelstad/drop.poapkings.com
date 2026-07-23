import { signal } from '@preact/signals'
import type { PublicPlayerSummary } from './api-contracts'

export const publicPlayerPreview = signal<PublicPlayerSummary | null>(null)

export function playerProfilePath(candidate: PublicPlayerSummary, currentPlayerId?: string): string {
  if (candidate.id === currentPlayerId) return '/profile'
  publicPlayerPreview.value = candidate
  return `/players/${encodeURIComponent(candidate.id)}`
}

export function playerIdFromRoute(value: string): string | undefined {
  const match = value.match(/^\/players\/([^/?#]+)/)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return undefined
  }
}
