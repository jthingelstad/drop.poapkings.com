import type { CompletedRun, GameMode, Player, Season, StartedRun } from '@elixir-drop/contracts'

interface ApiConfig {
  apiBaseUrl: string
}

export interface RecentRun {
  runId: string
  mode: GameMode
  score: number
  seasonId: string
  completedAt: string
}

export interface LeaderboardEntry {
  rank: number
  score: number
  achievedAt: string
  player: {
    id: string
    publicName: string
    favoriteCardId?: number
    playerTag?: string
    totalGames: number
    level: number
  }
}

let configPromise: Promise<ApiConfig> | undefined

async function config(): Promise<ApiConfig> {
  configPromise ??= fetch('/api-config.json', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('API configuration could not be loaded')
    return (await response.json()) as ApiConfig
  })
  return configPromise
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export async function apiRequest<T>(path: string, options: RequestInit & { sessionToken?: string } = {}): Promise<T> {
  const { apiBaseUrl } = await config()
  if (!apiBaseUrl) throw new ApiError(503, 'api_unavailable', 'Online player services are not configured yet.')
  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (options.body) headers.set('content-type', 'application/json')
  if (options.sessionToken) headers.set('authorization', `Bearer ${options.sessionToken}`)
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error?.code || 'request_failed',
      payload.error?.message || 'The request could not be completed.'
    )
  }
  return payload as T
}

export function requestLogin(email: string): Promise<{ ok: true; message: string }> {
  return apiRequest('/auth/request', { method: 'POST', body: JSON.stringify({ email }) })
}

export function redeemLogin(token: string): Promise<{ session: { token: string; expiresAt: string } }> {
  return apiRequest('/auth/redeem', { method: 'POST', body: JSON.stringify({ token }) })
}

export function refreshLogin(sessionToken: string): Promise<{ session: { token: string; expiresAt: string } }> {
  return apiRequest('/auth/refresh', { method: 'POST', sessionToken })
}

export function getMe(sessionToken: string): Promise<{ player: Player; recentRuns: RecentRun[] }> {
  return apiRequest('/me', { sessionToken })
}

export function getNameOptions(
  sessionToken: string,
  favoriteCardId: number
): Promise<{ favoriteCardId: number; names: string[]; nameToken: string }> {
  return apiRequest('/me/name-options', {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ favoriteCardId })
  })
}

export function patchMe(
  sessionToken: string,
  updates: {
    publicName?: string
    favoriteCardId?: number
    nameToken?: string
    playerTag?: string | null
  }
): Promise<{ player: Player }> {
  return apiRequest('/me', { method: 'PATCH', sessionToken, body: JSON.stringify(updates) })
}

export function startRun(mode: GameMode, sessionToken?: string): Promise<StartedRun> {
  return apiRequest('/runs/start', { method: 'POST', sessionToken, body: JSON.stringify({ mode }) })
}

export function completeRun(
  runToken: string,
  transcript: Record<string, unknown>,
  sessionToken?: string
): Promise<CompletedRun> {
  return apiRequest('/runs/complete', {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ runToken, transcript })
  })
}

export function getStats(): Promise<{ totalGames: number; authenticatedGames: number; currentSeason: Season }> {
  return apiRequest('/stats')
}

export function getLeaderboard(mode: GameMode): Promise<{
  mode: GameMode
  seasonId: string
  currentSeason: Season
  entries: LeaderboardEntry[]
}> {
  return apiRequest(`/leaderboards?mode=${encodeURIComponent(mode)}`)
}
