import { signal } from '@preact/signals'
import type { PublicPlayerSummary } from './api-contracts'

export const publicPlayerPreview = signal<PublicPlayerSummary | null>(null)

export const PUBLIC_PROFILE_SCOPES = ['badges', 'xp', 'log'] as const
export type PublicProfileScope = (typeof PUBLIC_PROFILE_SCOPES)[number]

export function publicProfileScopeFromRoute(value: string): PublicProfileScope {
  const query = value.split('?', 2)[1] || ''
  const requested = new URLSearchParams(query).get('scope')
  return PUBLIC_PROFILE_SCOPES.find((scope) => scope === requested) ?? 'badges'
}

export function publicProfilePath(playerId: string, scope: PublicProfileScope = 'badges'): string {
  const path = `/players/${encodeURIComponent(playerId)}`
  return scope === 'badges' ? path : `${path}?scope=${scope}`
}

export function playerProfilePath(candidate: PublicPlayerSummary, currentPlayerId?: string): string {
  if (candidate.id === currentPlayerId) return '/profile'
  publicPlayerPreview.value = candidate
  return publicProfilePath(candidate.id)
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
