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
  publishedBadgeShareSchema,
  publishedProfileShareSchema,
  publishedRunShareSchema,
  practiceCheckpointResponseSchema,
  practiceResumeResponseSchema,
  practiceResumeSummaryResponseSchema,
  runShareImageUploadResponseSchema,
  shareImageUploadResponseSchema,
  seasonHistoryResponseSchema,
  sessionResponseSchema,
  sharedInviteSchema,
  sharedRunSchema,
  siteStatsSchema,
  startedRunSchema,
  runReportResponseSchema,
  xpTimelineResponseSchema
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

export function requestLogin(
  email: string,
  returnTo?: string,
  recruiter?:
    | string
    | { token: string }
    | { playerId: string; runId: string }
    | { playerId: string; badgeSlug: string; rungIndex: number }
    | { playerId: string; profile: true }
    | { dropPlayerTag: string; invite: true }
) {
  return apiRequest('/auth/request', loginRequestResponseSchema, {
    method: 'POST',
    body: JSON.stringify({
      email,
      returnTo,
      ...(!recruiter
        ? {}
        : typeof recruiter === 'string'
          ? { recruiterToken: recruiter }
          : 'token' in recruiter
            ? { recruiterToken: recruiter.token }
            : { recruiterShare: recruiter })
    })
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
    season?: number | 'all'
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

export function getXpTimeline(sessionToken: string, signal?: AbortSignal) {
  return apiRequest('/me/xp', xpTimelineResponseSchema, { sessionToken, signal })
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

export async function completeRun(runToken: string, transcript: Record<string, unknown>, sessionToken?: string) {
  const request = () =>
    apiRequest('/runs/complete', completedRunSchema, {
      method: 'POST',
      sessionToken,
      body: JSON.stringify({ runToken, transcript }),
      // Completion is the one POST the API explicitly makes idempotent: after
      // the first write wins, a replay returns the stored result. Recover a
      // lost response here instead of making the player press Retry recording.
      retry: true
    })

  try {
    return await request()
  } catch (error) {
    // A fresh completion includes optional progress and badge projections while
    // the stored replay is deliberately minimal. If only that richer response
    // cannot be parsed, ask for the authoritative stored acknowledgement once.
    if (!(error instanceof ApiError) || error.code !== 'invalid_response') throw error
    await retryDelay()
    return request()
  }
}

export function getPracticeResume(sessionToken: string, signal?: AbortSignal) {
  return apiRequest('/practice/resume', practiceResumeResponseSchema, { sessionToken, signal })
}

export function getPracticeResumeSummary(sessionToken: string, signal?: AbortSignal) {
  return apiRequest('/practice/resume?summary=1', practiceResumeSummaryResponseSchema, { sessionToken, signal })
}

export function savePracticeCheckpoint(
  sessionToken: string,
  checkpoint: {
    runToken: string
    startIndex: number
    answers: Array<{
      cardId: number
      guess: number
      responseMs: number
      assisted: boolean
      correct: boolean
      reviewStage?: 'retry' | 'confirm'
    }>
    reviewQueue: Array<{ cardId: number; dueAtAnswered: number; stage: 'retry' | 'confirm' }>
    recovered: number
  }
) {
  return apiRequest('/practice/checkpoint', practiceCheckpointResponseSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify(checkpoint),
    // Immutable chunk writes are idempotent. A lost acknowledgement is safe to
    // replay and must not leave the client cursor behind the server cursor.
    retry: true
  })
}

export interface RunFailureReportInput {
  runId: string
  runToken: string
  failure: { code: string; status: number }
  client: {
    buildId: string
    online: boolean
    visibility: 'hidden' | 'visible' | 'prerender'
    displayMode: 'browser' | 'standalone'
  }
  context?: string
}

// The endpoint is idempotent per run, so the automatic report and an optional
// context update safely share the same POST and can retry without duplicates.
export function reportRunFailure(report: RunFailureReportInput, sessionToken?: string) {
  return apiRequest('/run-reports', runReportResponseSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify(report),
    retry: true
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
  // A specific Clash Royale season number from the Boards period rail. Only
  // meaningful in the 'season' scope; the current season is the default.
  clashSeasonNumber?: string
) {
  const params = new URLSearchParams({ mode })
  if (scope !== 'season') params.set('scope', scope)
  if (clashSeasonNumber) params.set('season', clashSeasonNumber)
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

// Publishing is deterministic: one recorded run has one permanent clean URL.
// `completedAt` binds Log shares to the exact immutable history row instead of
// relying on the short-lived RUN# item that powered the original summary-only
// flow.
export function publishRunShare(runId: string, completedAt: string, sessionToken: string) {
  return apiRequest(`/runs/${encodeURIComponent(runId)}/share`, publishedRunShareSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ completedAt }),
    retry: false
  })
}

async function imageBase64(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
  }
  return btoa(binary)
}

export async function uploadRunShareImage(runId: string, completedAt: string, image: Blob, sessionToken: string) {
  return apiRequest(`/runs/${encodeURIComponent(runId)}/share`, runShareImageUploadResponseSchema, {
    method: 'PUT',
    sessionToken,
    body: JSON.stringify({ completedAt, image: await imageBase64(image) }),
    retry: false,
    timeoutMs: 15_000
  })
}

export function publishBadgeShare(slug: string, rungIndex: number, sessionToken: string) {
  return apiRequest(`/badges/${encodeURIComponent(slug)}/share`, publishedBadgeShareSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ rungIndex }),
    retry: false
  })
}

export async function uploadBadgeShareImage(slug: string, rungIndex: number, image: Blob, sessionToken: string) {
  return apiRequest(`/badges/${encodeURIComponent(slug)}/share`, shareImageUploadResponseSchema, {
    method: 'PUT',
    sessionToken,
    body: JSON.stringify({ rungIndex, image: await imageBase64(image) }),
    retry: false,
    timeoutMs: 15_000
  })
}

export function publishProfileShare(sessionToken: string) {
  return apiRequest('/me/share', publishedProfileShareSchema, {
    method: 'POST',
    sessionToken,
    retry: false
  })
}

export async function uploadProfileShareImage(image: Blob, sessionToken: string) {
  return apiRequest('/me/share', shareImageUploadResponseSchema, {
    method: 'PUT',
    sessionToken,
    body: JSON.stringify({ image: await imageBase64(image) }),
    retry: false,
    timeoutMs: 15_000
  })
}

export function getSharedRun(token: string, signal?: AbortSignal, sessionToken?: string) {
  return apiRequest(`/shares/${encodeURIComponent(token)}`, sharedRunSchema, { signal, sessionToken })
}

export function getSharedInvite(token: string, signal?: AbortSignal, sessionToken?: string) {
  return apiRequest(`/shares/${encodeURIComponent(token)}`, sharedInviteSchema, { signal, sessionToken })
}

// Keep these public type aliases close to the request functions that return them.
export type LeaderboardResponse = Awaited<ReturnType<typeof getLeaderboard>>
export type { ActivityEntry, SharedInvite, SharedRun } from './api-contracts'
export type { LeaderboardEntry, RecentRun, SeasonHistory, SeasonIndexEntry } from './api-contracts'
export type { PublicPlayer, PublicPlayerSummary } from './api-contracts'
export type { XpTimeline } from './api-contracts'
