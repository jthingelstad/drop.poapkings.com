import type { GameMode } from '@elixir-drop/contracts'
import {
  accountDeletionResponseSchema,
  activityResponseSchema,
  apiConfigSchema,
  apiErrorSchema,
  completedRunSchema,
  leaderboardResponseSchema,
  loginPollResponseSchema,
  loginRequestResponseSchema,
  meResponseSchema,
  nameOptionsResponseSchema,
  playerResponseSchema,
  publicPlayerResponseSchema,
  seasonHistoryResponseSchema,
  sessionResponseSchema,
  sharedRunSchema,
  shareTokenSchema,
  siteStatsSchema,
  startedRunSchema
} from './api-contracts'
import { reportApiAvailable, reportApiUnavailable } from './api-availability'

interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown }
}

interface ApiRequestOptions extends RequestInit {
  sessionToken?: string
  retry?: boolean
  timeoutMs?: number
}

const REQUEST_TIMEOUT_MS = 8_000
const SAFE_RETRY_DELAY_MS = 180
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
// Home needs every ranked board, but sending them all at once creates a burst
// of parallel Lambda cold starts. Two concurrent boards keep progressive UI
// updates quick without turning one page load into a server-side fan-out.
const MAX_CONCURRENT_LEADERBOARDS = 2

let configPromise: Promise<{ apiBaseUrl: string }> | undefined
let activeLeaderboardRequests = 0
const leaderboardQueue: Array<() => void> = []

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function drainLeaderboardQueue(): void {
  while (activeLeaderboardRequests < MAX_CONCURRENT_LEADERBOARDS) {
    const start = leaderboardQueue.shift()
    if (!start) return
    start()
  }
}

function scheduleLeaderboardRequest<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new ApiError(0, 'request_cancelled', 'The request was cancelled.'))

  return new Promise<T>((resolve, reject) => {
    let started = false
    const start = () => {
      started = true
      signal?.removeEventListener('abort', cancel)
      activeLeaderboardRequests += 1
      void request()
        .then(resolve, reject)
        .finally(() => {
          activeLeaderboardRequests -= 1
          drainLeaderboardQueue()
        })
    }
    const cancel = () => {
      if (started) return
      const queuedIndex = leaderboardQueue.indexOf(start)
      if (queuedIndex >= 0) leaderboardQueue.splice(queuedIndex, 1)
      reject(new ApiError(0, 'request_cancelled', 'The request was cancelled.'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    leaderboardQueue.push(start)
    drainLeaderboardQueue()
  })
}

function contractIssueCount(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('issues' in error)) return undefined
  const issues = (error as { issues?: unknown }).issues
  return Array.isArray(issues) ? issues.length : undefined
}

function validateResponse<T>(schema: ResponseSchema<T>, payload: unknown, path: string): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  console.warn('API response contract failed', { path, issues: contractIssueCount(parsed.error) })
  throw new ApiError(502, 'invalid_response', 'Drop received an invalid response from player services.')
}

function parsePayload(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController()
  const externalSignal = init.signal
  let timedOut = false
  const forwardAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    // Read the body under the same timeout: a connection that stalls after
    // the headers arrive was the one remaining unbounded await.
    const text = await response.text()
    return { response, text }
  } catch (error) {
    if (timedOut) throw new ApiError(0, 'request_timeout', 'Player services took too long to respond. Try again.')
    if (externalSignal?.aborted) throw new ApiError(0, 'request_cancelled', 'The request was cancelled.')
    throw new ApiError(0, 'network_unavailable', 'Drop could not reach player services. Check your connection.')
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', forwardAbort)
  }
}

function retryable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'network_unavailable' || error.code === 'request_timeout' || RETRYABLE_STATUSES.has(error.status))
  )
}

function serviceUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'network_unavailable' || error.code === 'request_timeout' || error.status >= 500)
  )
}

async function retryDelay(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ApiError(0, 'request_cancelled', 'The request was cancelled.')
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }
    const timer = window.setTimeout(finish, SAFE_RETRY_DELAY_MS)
    const cancel = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(new ApiError(0, 'request_cancelled', 'The request was cancelled.'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

async function requestPayload(url: string, init: RequestInit, canRetry: boolean, timeoutMs: number): Promise<unknown> {
  const attempts = canRetry ? 2 : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { response, text } = await fetchWithTimeout(url, init, timeoutMs)
      const payload = parsePayload(text)
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload)
        const apiError = new ApiError(
          response.status,
          parsedError.success ? parsedError.data.error?.code || 'request_failed' : 'request_failed',
          parsedError.success
            ? parsedError.data.error?.message || 'The request could not be completed.'
            : 'The request could not be completed.'
        )
        if (response.status < 500) reportApiAvailable()
        throw apiError
      }
      reportApiAvailable()
      return payload
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) {
        if (serviceUnavailable(error)) reportApiUnavailable()
        throw error
      }
      await retryDelay(init.signal ?? undefined)
    }
  }
  throw new ApiError(0, 'network_unavailable', 'Drop could not reach player services.')
}

async function config(): Promise<{ apiBaseUrl: string }> {
  if (!configPromise) {
    configPromise = requestPayload('/api-config.json', { cache: 'no-store' }, true, REQUEST_TIMEOUT_MS)
      .then((payload) => validateResponse(apiConfigSchema, payload, '/api-config.json'))
      .catch((error: unknown) => {
        configPromise = undefined
        throw error
      })
  }
  return configPromise
}

export async function apiRequest<T>(
  path: string,
  schema: ResponseSchema<T>,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { apiBaseUrl } = await config()
  if (!apiBaseUrl) throw new ApiError(503, 'api_unavailable', 'Online player services are not configured yet.')

  const { sessionToken, retry, timeoutMs = REQUEST_TIMEOUT_MS, ...requestInit } = options
  const headers = new Headers(requestInit.headers)
  headers.set('accept', 'application/json')
  if (requestInit.body) headers.set('content-type', 'application/json')
  if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`)
  const method = (requestInit.method || 'GET').toUpperCase()
  const canRetry = retry ?? (method === 'GET' || method === 'HEAD')
  const payload = await requestPayload(`${apiBaseUrl}${path}`, { ...requestInit, headers }, canRetry, timeoutMs)
  return validateResponse(schema, payload, path)
}

export function requestLogin(email: string, returnTo?: string, recruiterToken?: string) {
  return apiRequest('/auth/request', loginRequestResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, returnTo, recruiterToken })
  })
}

export function redeemLogin(token: string) {
  return apiRequest('/auth/redeem', sessionResponseSchema, { method: 'POST', body: JSON.stringify({ token }) })
}

// Poll for a session handed off by a magic link redeemed in another browser
// context (e.g. the emailed link opened Safari while the player waits in the
// installed PWA). Returns { ready: false } until the link is opened.
export function pollLogin(pollId: string, signal?: AbortSignal) {
  return apiRequest('/auth/poll', loginPollResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ pollId }),
    signal
  })
}

export function refreshLogin(sessionToken: string) {
  return apiRequest('/auth/refresh', sessionResponseSchema, { method: 'POST', sessionToken })
}

export function getMe(sessionToken: string, signal?: AbortSignal) {
  return apiRequest('/me', meResponseSchema, { sessionToken, signal })
}

export function getNameOptions(sessionToken: string, favoriteCardId: number) {
  return apiRequest('/me/name-options', nameOptionsResponseSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ favoriteCardId })
  })
}

// Season history, one season at a time. The response always carries a
// lightweight `index` of every season the player has runs in, so the You page
// can offer a season picker and page older seasons in without ever pulling a
// whole career across the wire. Pass `season: 'all'` to opt into that
// deliberately; omit `season` for the most recent one.
export function getSeasonHistory(
  sessionToken: string,
  signal?: AbortSignal,
  filters: {
    season?: string
    mode?: GameMode
    status?: 'pending' | 'reviewed' | 'excluded' | 'unreviewed'
    // Board placements cost one leaderboard read per mode played, so they are
    // asked for rather than assumed.
    placements?: boolean
  } = {}
) {
  const query = new URLSearchParams(
    Object.entries(filters).flatMap(([key, value]) =>
      value ? [[key, value === true ? '1' : String(value)] as [string, string]] : []
    )
  ).toString()
  return apiRequest(`/me/seasons${query ? `?${query}` : ''}`, seasonHistoryResponseSchema, { sessionToken, signal })
}

export function patchMe(
  sessionToken: string,
  updates: {
    publicName?: string
    favoriteCardId?: number
    nameToken?: string
    playerTag?: string | null
    // The server stamps the read time; any value here is just the trigger.
    lastOpenedUpdates?: string
  }
) {
  return apiRequest('/me', playerResponseSchema, {
    method: 'PATCH',
    sessionToken,
    body: JSON.stringify(updates)
  })
}

export function deleteMe(sessionToken: string, confirmation: string) {
  return apiRequest('/me', accountDeletionResponseSchema, {
    method: 'DELETE',
    sessionToken,
    body: JSON.stringify({ confirmation })
  })
}

// The session token is optional: with none, the request is a guest request and
// the server deals/scores a run that is never recorded. apiRequest only sends
// the authorization header when a token is present.
export function startRun(mode: GameMode, sessionToken?: string) {
  return apiRequest('/runs/start', startedRunSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ mode })
  })
}

export function completeRun(runToken: string, transcript: Record<string, unknown>, sessionToken?: string) {
  return apiRequest('/runs/complete', completedRunSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ runToken, transcript })
  })
}

export function getStats(signal?: AbortSignal) {
  return apiRequest('/stats', siteStatsSchema, { signal })
}

export interface ApiDiagnostics {
  endpoint: string
  latencyMs: number
  webVersion?: string
}

// A single uncached round trip for App Info. Challenge preparation completes
// before any game clock starts, so this is connection readiness—not a score
// adjustment or an estimate of in-game timing accuracy.
export async function getApiDiagnostics(signal?: AbortSignal): Promise<ApiDiagnostics> {
  const { apiBaseUrl } = await config()
  const startedAt = performance.now()
  const stats = await apiRequest(`/stats?diagnostic=${Date.now()}`, siteStatsSchema, {
    signal,
    retry: false,
    timeoutMs: 5_000,
    cache: 'no-store'
  })
  return {
    endpoint: apiBaseUrl,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    webVersion: stats.webVersion
  }
}

export type LeaderboardScope = 'season' | 'all-time' | 'clan'

export function getLeaderboard(
  mode: GameMode,
  scope: LeaderboardScope = 'season',
  signal?: AbortSignal,
  sessionToken?: string,
  // A specific past season's board (Boards period rail). Only meaningful in the
  // 'season' scope; the current season is the default when omitted.
  seasonId?: string
) {
  const params = new URLSearchParams({ mode })
  if (scope !== 'season') params.set('scope', scope)
  if (seasonId) params.set('season', seasonId)
  const query = `/leaderboards?${params.toString()}`
  return scheduleLeaderboardRequest(
    () => apiRequest(query, leaderboardResponseSchema, { signal, sessionToken }),
    signal
  )
}

export function getActivity(limit = 8, signal?: AbortSignal) {
  return apiRequest(`/activity?limit=${limit}`, activityResponseSchema, { signal })
}

export function getPublicPlayer(playerId: string, signal?: AbortSignal) {
  return apiRequest(`/players/${encodeURIComponent(playerId)}`, publicPlayerResponseSchema, { signal })
}

// One token per share ACTION — sharing the same run twice mints two tokens,
// which is what makes Herald countable per share rather than per run. Only a
// recorded run can mint: an offline or guest run has no server record, so the
// browser never offers the control at all.
export function createShareToken(runId: string, sessionToken: string, series?: number[]) {
  return apiRequest(`/runs/${encodeURIComponent(runId)}/share`, shareTokenSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify(series?.length ? { series } : {}),
    retry: false
  })
}

export function getSharedRun(token: string, signal?: AbortSignal, sessionToken?: string) {
  return apiRequest(`/shares/${encodeURIComponent(token)}`, sharedRunSchema, { signal, sessionToken })
}

// Keep these public type aliases close to the request functions that return them.
export type LeaderboardResponse = Awaited<ReturnType<typeof getLeaderboard>>
export type { ActivityEntry, SharedRun } from './api-contracts'
export type { LeaderboardEntry, RecentRun, SeasonHistory, SeasonIndexEntry } from './api-contracts'
export type { PublicPlayer, PublicPlayerSummary } from './api-contracts'
