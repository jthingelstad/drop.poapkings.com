import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dropSharePayload,
  runSharePayload,
  shareRun,
  shareRunCard,
  type ShareableGameMode
} from '../../src/lib/share-run'

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

  it.each<[ShareableGameMode, string, string]>([
    ['surge', '15.04s', 'Surge'],
    ['higher-lower', '12 streak', 'Higher / Lower'],
    ['trade', '9.42s', 'Trade'],
    ['survival', '18 streak', 'Survival'],
    ['rain', '27 cleared', 'Rain']
  ])('builds a game-specific payload for %s', (mode, score, gameName) => {
    // The link is the run's own minted permalink, passed through verbatim: it is
    // what gets counted, so nothing may quietly rewrite it to a mode's home.
    const permalink = 'https://drop.poapkings.com/#/r/AB2CD3'
    const payload = runSharePayload(mode, score, permalink)

    expect(payload.title).toBe(`${gameName}: ${score} | Elixir Drop`)
    expect(payload.text).toContain(`I scored ${score} in ${gameName} on Elixir Drop.`)
    expect(payload.url).toBe(permalink)
    expect(payload.copyText).toBe(`${payload.text}\n${payload.url}`)
  })

  it('puts the public player name in both share-sheet fields', () => {
    const payload = runSharePayload('surge', '15.04s', 'https://drop.poapkings.com/', 'Knight Main')

    expect(payload.title).toBe('Knight Main · Surge: 15.04s | Elixir Drop')
    expect(payload.text).toBe('Knight Main scored 15.04s in Surge on Elixir Drop. Can you beat it?')
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

// The composited card is strictly an upgrade over the text share. Every one of
// these paths must land on the text share rather than leaving the player with a
// button that did nothing.
describe('share card fallback', () => {
  function setCanShare(value: unknown): void {
    Object.defineProperty(navigator, 'canShare', { value, configurable: true })
  }

  afterEach(() => {
    setCanShare(undefined)
  })

  it('shares text when the browser cannot share files at all', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('share', share)
    setCanShare(() => false)

    const outcome = await shareRunCard(runSharePayload('surge', '15.04s', 'https://drop.poapkings.com/#/r/AB2CD3'), {
      mode: 'surge',
      score: '15.04s'
    })

    expect(outcome).toBe('shared')
    // Text share: no files key on the payload.
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty('files')
  })

  it('falls back to text when the card cannot be rendered', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('share', share)
    setCanShare(() => true)
    // jsdom has no canvas, so renderShareCard returns null via getContext.
    const outcome = await shareRunCard(runSharePayload('rain', '27 cleared', 'https://drop.poapkings.com/#/r/AB2CD3'), {
      mode: 'rain',
      score: '27 cleared'
    })

    expect(outcome).toBe('shared')
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty('files')
  })

  it('copies when nothing can share at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigatorMethod('clipboard', { writeText })
    setCanShare(() => true)

    const outcome = await shareRunCard(runSharePayload('trade', '9.42s', 'https://drop.poapkings.com/#/r/AB2CD3'), {
      mode: 'trade',
      score: '9.42s'
    })

    expect(outcome).toBe('copied')
    expect(writeText).toHaveBeenCalledOnce()
  })
})
