import type { GameMode } from '@elixir-drop/contracts'
import {
  apiConfigSchema,
  apiErrorSchema,
  completedRunSchema,
  leaderboardResponseSchema,
  loginRequestResponseSchema,
  meResponseSchema,
  nameOptionsResponseSchema,
  playerResponseSchema,
  sessionResponseSchema,
  siteStatsSchema,
  startedRunSchema
} from './api-contracts'

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

let configPromise: Promise<{ apiBaseUrl: string }> | undefined

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

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
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
    return await fetch(url, { ...init, signal: controller.signal })
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
      const response = await fetchWithTimeout(url, init, timeoutMs)
      const payload = await responsePayload(response)
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload)
        throw new ApiError(
          response.status,
          parsedError.success ? parsedError.data.error?.code || 'request_failed' : 'request_failed',
          parsedError.success
            ? parsedError.data.error?.message || 'The request could not be completed.'
            : 'The request could not be completed.'
        )
      }
      return payload
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) throw error
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

export function requestLogin(email: string, returnTo?: string) {
  return apiRequest('/auth/request', loginRequestResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, returnTo })
  })
}

export function redeemLogin(token: string) {
  return apiRequest('/auth/redeem', sessionResponseSchema, { method: 'POST', body: JSON.stringify({ token }) })
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

export function patchMe(
  sessionToken: string,
  updates: {
    publicName?: string
    favoriteCardId?: number
    nameToken?: string
    playerTag?: string | null
  }
) {
  return apiRequest('/me', playerResponseSchema, {
    method: 'PATCH',
    sessionToken,
    body: JSON.stringify(updates)
  })
}

export function startRun(mode: GameMode, sessionToken: string) {
  return apiRequest('/runs/start', startedRunSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ mode })
  })
}

export function completeRun(runToken: string, transcript: Record<string, unknown>, sessionToken: string) {
  return apiRequest('/runs/complete', completedRunSchema, {
    method: 'POST',
    sessionToken,
    body: JSON.stringify({ runToken, transcript })
  })
}

export function getStats(signal?: AbortSignal) {
  return apiRequest('/stats', siteStatsSchema, { signal })
}

export function getLeaderboard(mode: GameMode, signal?: AbortSignal) {
  return apiRequest(`/leaderboards?mode=${encodeURIComponent(mode)}`, leaderboardResponseSchema, { signal })
}

// Keep these public type aliases close to the request functions that return them.
export type LeaderboardResponse = Awaited<ReturnType<typeof getLeaderboard>>
export type { LeaderboardEntry, RecentRun } from './api-contracts'
