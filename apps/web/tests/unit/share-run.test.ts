import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLink } from '../../src/lib/share-run'

function setNavigatorMethod(name: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true })
}

afterEach(() => {
  setNavigatorMethod('share', undefined)
  setNavigatorMethod('clipboard', undefined)
  vi.restoreAllMocks()
})

describe('run sharing', () => {
  it('hands a published run link to the native sheet without text or files', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('share', share)

    await expect(shareLink('https://drop.poapkings.com/share/player/run')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ url: 'https://drop.poapkings.com/share/player/run' })
  })

  it('copies only the published run link when no native sheet exists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('clipboard', { writeText })

    await expect(shareLink('https://drop.poapkings.com/share/player/run')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://drop.poapkings.com/share/player/run')
  })

  it('does not copy when the player cancels the native share sheet', async () => {
    const writeText = vi.fn()
    setNavigatorMethod('share', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')))
    setNavigatorMethod('clipboard', { writeText })

    await expect(shareLink('https://drop.poapkings.com/share/P1111111111')).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('returns the link for an explicit visible fallback when neither browser API works', async () => {
    setNavigatorMethod('share', undefined)
    setNavigatorMethod('clipboard', undefined)

    await expect(shareLink('https://drop.poapkings.com/share/P1111111111')).resolves.toBe('unavailable')
  })
})
