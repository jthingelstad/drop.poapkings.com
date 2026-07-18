import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const currentSeason = {
  id: '2026-07',
  startsAt: '2026-07-06T10:00:00.000Z',
  endsAt: '2026-08-03T10:00:00.000Z',
  durationWeeks: 4
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('API resilience', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('validates successful responses before returning them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: 'https://api.example' }))
      .mockResolvedValueOnce(json({ trophyRoadGames: 592, currentSeason }))
    vi.stubGlobal('fetch', fetchMock)
    const { getStats } = await import('../../src/lib/api')

    await expect(getStats()).resolves.toMatchObject({ trophyRoadGames: 592 })
  })

  it('rejects malformed success payloads with a stable API error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: 'https://api.example' }))
      .mockResolvedValueOnce(json({ trophyRoadGames: 592 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getStats } = await import('../../src/lib/api')

    await expect(getStats()).rejects.toMatchObject({ status: 502, code: 'invalid_response' })
  })

  it('retries one transient failure for safe reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: 'https://api.example' }))
      .mockResolvedValueOnce(json({ error: { code: 'temporarily_unavailable', message: 'Try again.' } }, 503))
      .mockResolvedValueOnce(json({ trophyRoadGames: 593, currentSeason }))
    vi.stubGlobal('fetch', fetchMock)
    const { getStats } = await import('../../src/lib/api')

    await expect(getStats()).resolves.toMatchObject({ trophyRoadGames: 593 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('bounds a stalled request with a timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api-config.json'))
        return Promise.resolve(json({ apiBaseUrl: 'https://api.example' }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apiRequest } = await import('../../src/lib/api')
    const responseSchema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) }

    const request = apiRequest('/slow', responseSchema, { timeoutMs: 25, retry: false })
    const rejected = expect(request).rejects.toMatchObject({ status: 0, code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(25)

    await rejected
  })
})
