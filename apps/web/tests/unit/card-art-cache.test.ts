import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  allCardArtUrls,
  cardArtBatches,
  cardArtCacheName,
  getCardArtCacheInfo,
  initCardArtCache
} from '../../src/lib/card-art-cache'
import { allCards, cardCatalogVersion } from '../../src/lib/card-catalog'

describe('card art cache', () => {
  const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
  const matchMedia = window.matchMedia
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  const cachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (serviceWorkerDescriptor) Object.defineProperty(navigator, 'serviceWorker', serviceWorkerDescriptor)
    else Reflect.deleteProperty(navigator, 'serviceWorker')
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
    if (cachesDescriptor) Object.defineProperty(globalThis, 'caches', cachesDescriptor)
    else Reflect.deleteProperty(globalThis, 'caches')
  })

  it('packs exactly one unique base image per catalog card', () => {
    const expected = [...new Set(allCards.map((card) => card.icon))]

    expect(allCardArtUrls).toEqual(expected)
    expect(allCardArtUrls).toHaveLength(allCards.length)
    expect(allCardArtUrls.every((url) => /^\/cards\/\d+\.png$/.test(url))).toBe(true)
    expect(allCardArtUrls.some((url) => /_(?:evo|hero)\.png$/.test(url))).toBe(false)
  })

  it('splits the offline pack into bounded ordered batches', () => {
    expect(cardArtBatches(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('registers the runtime cache for web visits without filling the full catalog', async () => {
    const postMessage = vi.fn()
    const register = vi.fn(async () => ({}))
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve({ active: { postMessage } }) }
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false }))
    })

    await initCardArtCache(true)
    vi.runAllTimers()

    expect(register).toHaveBeenCalledWith(
      expect.stringContaining(`catalog=${encodeURIComponent(cardCatalogVersion)}`),
      { scope: '/', updateViaCache: 'none' }
    )
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('progressively sends bounded batches when running as an installed PWA', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn(async () => ({})),
        ready: Promise.resolve({ active: { postMessage } })
      }
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true }))
    })

    await initCardArtCache(true)
    expect(postMessage).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'cache-card-art', urls: allCardArtUrls.slice(0, 4) })
    vi.advanceTimersByTime(750)
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'cache-card-art', urls: allCardArtUrls.slice(4, 8) })
  })

  it('reports the active worker and only current-catalog card images in the cache', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({ active: { state: 'activated' } }))
      }
    })
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn(async () => [cardArtCacheName]),
        open: vi.fn(async () => ({
          keys: vi.fn(async () => [
            { url: `https://drop.poapkings.com${allCardArtUrls[0]}` },
            { url: `https://drop.poapkings.com${allCardArtUrls[1]}` },
            { url: 'https://drop.poapkings.com/cards/99999999.png' },
            { url: 'https://drop.poapkings.com/assets/index.js' }
          ])
        }))
      }
    })

    await expect(getCardArtCacheInfo()).resolves.toEqual({
      supported: true,
      workerState: 'activated',
      cacheName: cardArtCacheName,
      cachedCount: 2,
      totalCount: allCardArtUrls.length,
      ready: false
    })
  })

  it('reports unsupported diagnostics without creating a cache', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    Reflect.deleteProperty(globalThis, 'caches')

    await expect(getCardArtCacheInfo()).resolves.toMatchObject({
      supported: false,
      workerState: 'unsupported',
      cachedCount: 0,
      totalCount: allCardArtUrls.length,
      ready: false
    })
  })

  it('ships a card-only service worker with runtime and background cache paths', () => {
    const source = readFileSync('public/card-art-sw.js', 'utf8')
    expect(source).toContain('const cardPath = /^\\/cards\\/')
    expect(source).toContain('event.respondWith(fetchAndCache(event.request))')
    expect(source).toContain("event.data?.type !== 'cache-card-art'")
    expect(source).toContain("const LEGACY_CARD_CACHE_PREFIX = 'elixir-drop-card-art-'")
    expect(source).toContain('name.startsWith(LEGACY_CARD_CACHE_PREFIX)')
    expect(cardArtCacheName).toBe(`elixir-drop-card-art-base-${cardCatalogVersion}`)
  })
})
