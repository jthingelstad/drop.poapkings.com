import { afterEach, describe, expect, it, vi } from 'vitest'
import { dropSharePayload, shareLink, shareRun } from '../../src/lib/share-run'

function setNavigatorMethod(name: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true })
}

afterEach(() => {
  setNavigatorMethod('share', undefined)
  setNavigatorMethod('clipboard', undefined)
  vi.restoreAllMocks()
})

describe('run sharing', () => {
  it('builds a clean root link for sharing Elixir Drop itself', () => {
    const payload = dropSharePayload('https://drop.poapkings.com/#/s/AB2CD3')

    expect(payload.title).toContain('Elixir Drop')
    expect(payload.url).toBe('https://drop.poapkings.com/#/s/AB2CD3')
    expect(payload.copyText).toBe(`${payload.text}\n${payload.url}`)
  })

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

  it('uses the native browser share feature when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    setNavigatorMethod('share', share)
    setNavigatorMethod('clipboard', { writeText })
    const payload = dropSharePayload('https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: payload.title, text: payload.text, url: payload.url })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the complete text and game link when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('share', undefined)
    setNavigatorMethod('clipboard', { writeText })
    const payload = dropSharePayload('https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(payload.copyText)
  })

  it('does not copy when the player cancels the native share sheet', async () => {
    const writeText = vi.fn()
    setNavigatorMethod('share', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')))
    setNavigatorMethod('clipboard', { writeText })
    const payload = dropSharePayload('https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })
})
