import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameMode } from '@elixir-drop/contracts'
import { runSharePayload, shareRun } from '../../src/lib/share-run'

function setNavigatorMethod(name: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true })
}

afterEach(() => {
  setNavigatorMethod('share', undefined)
  setNavigatorMethod('clipboard', undefined)
  vi.restoreAllMocks()
})

describe('run sharing', () => {
  it.each<[GameMode, string, string]>([
    ['surge', '15.04s', 'Surge'],
    ['practice', '93% accuracy', 'Practice'],
    ['higher-lower', '12 streak', 'Higher / Lower'],
    ['trade', '9.42s', 'Trade'],
    ['survival', '18 streak', 'Survival'],
    ['rain', '27 cleared', 'Rain']
  ])('builds a game-specific payload for %s', (mode, score, gameName) => {
    const payload = runSharePayload(mode, score, 'https://drop.poapkings.com/?source=test#/profile')

    expect(payload.title).toBe(`${gameName}: ${score} | Elixir Drop`)
    expect(payload.text).toContain(`I scored ${score} in ${gameName} on Elixir Drop.`)
    expect(payload.url).toBe(`https://drop.poapkings.com/#/${mode}`)
    expect(payload.copyText).toBe(`${payload.text}\n${payload.url}`)
  })

  it('uses the native browser share feature when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    setNavigatorMethod('share', share)
    setNavigatorMethod('clipboard', { writeText })
    const payload = runSharePayload('surge', '15.04s', 'https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: payload.title, text: payload.text, url: payload.url })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the complete text and game link when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('share', undefined)
    setNavigatorMethod('clipboard', { writeText })
    const payload = runSharePayload('rain', '27 cleared', 'https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(payload.copyText)
  })

  it('does not copy when the player cancels the native share sheet', async () => {
    const writeText = vi.fn()
    setNavigatorMethod('share', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')))
    setNavigatorMethod('clipboard', { writeText })
    const payload = runSharePayload('trade', '9.42s', 'https://drop.poapkings.com/')

    await expect(shareRun(payload)).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })
})
