import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pin this tab's build id so the comparison is deterministic (real builds carry
// a git sha; the dev fallback is intentionally ignored by noteWebVersion).
vi.mock('../../src/lib/build', () => ({
  buildMeta: { id: 'aaaaaaaaaaaa', dateIso: undefined, dateLabel: 'test' }
}))

import { checkForWebUpdate, latestVersionUrl, noteWebVersion, updateAvailable } from '../../src/lib/version'

beforeEach(() => {
  updateAvailable.value = false
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('noteWebVersion', () => {
  it('flags an update when the server reports a different build', () => {
    noteWebVersion('bbbbbbbbbbbb')
    expect(updateAvailable.value).toBe(true)
  })

  it('stays quiet when the versions match', () => {
    noteWebVersion('aaaaaaaaaaaa')
    expect(updateAvailable.value).toBe(false)
  })

  it('ignores a missing server version', () => {
    noteWebVersion(undefined)
    expect(updateAvailable.value).toBe(false)
  })

  it('stays quiet when local visual QA explicitly disables update notices', () => {
    vi.stubEnv('VITE_DISABLE_UPDATE_NOTICE', '1')
    noteWebVersion('bbbbbbbbbbbb')
    expect(updateAvailable.value).toBe(false)
  })

  it('latches on once an update is known', () => {
    noteWebVersion('bbbbbbbbbbbb')
    noteWebVersion('aaaaaaaaaaaa')
    expect(updateAvailable.value).toBe(true)
  })
})

describe('checkForWebUpdate', () => {
  it('reads the uncached web manifest and compares its version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ webVersion: 'bbbbbbbbbbbb' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    )

    await checkForWebUpdate(fetcher, 123)

    expect(fetcher).toHaveBeenCalledWith('/version.json?check=123', { cache: 'no-store' })
    expect(updateAvailable.value).toBe(true)
  })

  it('treats an unreachable or malformed manifest as an offline no-op', async () => {
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    await checkForWebUpdate(unavailable, 123)
    expect(updateAvailable.value).toBe(false)

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    await checkForWebUpdate(malformed, 456)
    expect(updateAvailable.value).toBe(false)
  })
})

describe('latestVersionUrl', () => {
  it('cache-busts the app shell while preserving the active game route', () => {
    expect(latestVersionUrl('https://drop.poapkings.com/#/higher-lower', 123)).toBe(
      'https://drop.poapkings.com/?drop-refresh=123#/higher-lower'
    )
  })

  it('replaces an earlier refresh token instead of accumulating them', () => {
    expect(latestVersionUrl('https://drop.poapkings.com/?drop-refresh=old#/rain', 456)).toBe(
      'https://drop.poapkings.com/?drop-refresh=456#/rain'
    )
  })
})
