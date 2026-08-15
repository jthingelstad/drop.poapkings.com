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

  function activeRegistration(workerUrl: string, postMessage: ReturnType<typeof vi.fn>) {
    const worker = Object.assign(new EventTarget(), {
      scriptURL: new URL(workerUrl, window.location.href).href,
      state: 'activated' as ServiceWorkerState,
      postMessage
    }) as unknown as ServiceWorker
    return Object.assign(new EventTarget(), {
      active: worker,
      waiting: null,
      installing: null
    }) as unknown as ServiceWorkerRegistration
  }

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
    const register = vi.fn(async (workerUrl: string) => activeRegistration(workerUrl, postMessage))
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register }
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
    // Every visit hands over the shell so the app can open offline; only an
    // installed PWA fills the whole card-art pack.
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'cache-shell', urls: expect.arrayContaining(['/']) })
  })

  it('progressively sends bounded batches when running as an installed PWA', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn(async (workerUrl: string) => activeRegistration(workerUrl, postMessage))
      }
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true }))
    })

    await initCardArtCache(true)
    // The shell goes over immediately; the card-art batches are still paced.
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'cache-shell', urls: expect.arrayContaining(['/']) })

    vi.advanceTimersByTime(750)
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'cache-card-art', urls: allCardArtUrls.slice(0, 4) })
    vi.advanceTimersByTime(750)
    expect(postMessage).toHaveBeenNthCalledWith(3, { type: 'cache-card-art', urls: allCardArtUrls.slice(4, 8) })
  })

  it('waits for the newly registered worker instead of filling through the retiring worker', async () => {
    const oldPostMessage = vi.fn()
    const newPostMessage = vi.fn()
    let newState: ServiceWorkerState = 'installing'
    let newWorkerUrl = ''
    const oldWorker = Object.assign(new EventTarget(), {
      scriptURL: 'https://drop.poapkings.com/card-art-sw.js?build=previous&catalog=previous',
      state: 'activated' as ServiceWorkerState,
      postMessage: oldPostMessage
    }) as unknown as ServiceWorker
    const newWorker = new EventTarget() as ServiceWorker
    Object.defineProperties(newWorker, {
      scriptURL: { configurable: true, get: () => new URL(newWorkerUrl, window.location.href).href },
      state: { configurable: true, get: () => newState },
      postMessage: { configurable: true, value: newPostMessage }
    })
    const registration = new EventTarget() as ServiceWorkerRegistration
    Object.defineProperties(registration, {
      active: { configurable: true, get: () => (newState === 'activated' ? newWorker : oldWorker) },
      waiting: { configurable: true, get: () => null },
      installing: { configurable: true, get: () => (newState === 'activated' ? null : newWorker) }
    })
    const register = vi.fn(async (workerUrl: string) => {
      newWorkerUrl = workerUrl
      return registration
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve({ active: oldWorker }) }
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true }))
    })

    const initialization = initCardArtCache(true)
    await Promise.resolve()
    expect(oldPostMessage).not.toHaveBeenCalled()

    newState = 'activated'
    newWorker.dispatchEvent(new Event('statechange'))
    await initialization
    vi.advanceTimersByTime(750)

    expect(oldPostMessage).not.toHaveBeenCalled()
    expect(newPostMessage).toHaveBeenCalledWith({ type: 'cache-card-art', urls: allCardArtUrls.slice(0, 4) })
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

  it('ships a service worker with runtime and background card-art cache paths', () => {
    const source = readFileSync('public/card-art-sw.js', 'utf8')
    expect(source).toContain('const cardPath = /^\\/cards\\/')
    expect(source).toContain('event.respondWith(fetchAndCache(event.request))')
    expect(source).toContain("event.data?.type !== 'cache-card-art'")
    expect(source).toContain("const LEGACY_CARD_CACHE_PREFIX = 'elixir-drop-card-art-'")
    expect(source).toContain('name.startsWith(LEGACY_CARD_CACHE_PREFIX)')
    expect(cardArtCacheName).toBe(`elixir-drop-card-art-base-${cardCatalogVersion}`)
  })

  it('keys the app shell to the build so a release retires it', () => {
    const source = readFileSync('public/card-art-sw.js', 'utf8')
    // Card art survives a release (keyed to the catalog); the shell must not
    // (keyed to the build), or a player is stranded on an old app.
    expect(source).toContain("const SHELL_CACHE_PREFIX = 'elixir-drop-shell-'")
    expect(source).toContain("params.get('build')")
    expect(source).toContain('name.startsWith(SHELL_CACHE_PREFIX) && name !== shellCacheName')
  })

  it('serves navigation network-first and never caches the API config', () => {
    const source = readFileSync('public/card-art-sw.js', 'utf8')
    // Network-first is what keeps the cached shell a fallback rather than a
    // stale app: online players always get the newest document.
    expect(source).toContain('shellNavigation(event.request)')
    expect(source).toContain('const response = await fetch(request)')
    expect(source).toContain("NEVER_CACHE = new Set(['/api-config.json', '/card-art-sw.js'])")
  })
})
