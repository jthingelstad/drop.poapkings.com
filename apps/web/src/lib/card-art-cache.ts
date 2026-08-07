import { buildMeta } from './build'
import { allCards, cardCatalogVersion } from './card-catalog'

const CARD_ART_BATCH_SIZE = 4
const CARD_ART_BATCH_DELAY_MS = 750
const CACHE_MESSAGE = 'cache-card-art'
const CARD_CACHE_PREFIX = 'elixir-drop-card-art-'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

// Include base, Evolution, and Hero art. Game modes currently draw the base
// URLs, while profile/avatar surfaces can grow into the variants without
// needing a second offline pack later.
export const allCardArtUrls = [
  ...new Set(allCards.flatMap((card) => [card.icon, card.iconEvo, card.iconHero].filter((url): url is string => !!url)))
]
export const cardArtCacheName = `${CARD_CACHE_PREFIX}${cardCatalogVersion}`

export interface CardArtCacheInfo {
  supported: boolean
  workerState: ServiceWorkerState | 'missing' | 'unsupported'
  cacheName: string
  cachedCount: number
  totalCount: number
  ready: boolean
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function cardArtBatches(urls: readonly string[], size = CARD_ART_BATCH_SIZE): string[][] {
  const batchSize = Math.max(1, Math.floor(size))
  const batches: string[][] = []
  for (let index = 0; index < urls.length; index += batchSize) batches.push(urls.slice(index, index + batchSize))
  return batches
}

// Read-only diagnostics for the installed-app information screen. Cache keys
// are counted against the current catalog so stale or unrelated responses can
// never make the pack look complete.
export async function getCardArtCacheInfo(): Promise<CardArtCacheInfo> {
  const unsupported: CardArtCacheInfo = {
    supported: false,
    workerState: 'unsupported',
    cacheName: cardArtCacheName,
    cachedCount: 0,
    totalCount: allCardArtUrls.length,
    ready: false
  }
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof navigator.serviceWorker.getRegistration !== 'function' ||
    typeof caches === 'undefined'
  ) {
    return unsupported
  }

  const registration = await navigator.serviceWorker.getRegistration('/')
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing
  const names = await caches.keys()
  let cachedCount = 0

  if (names.includes(cardArtCacheName)) {
    const cache = await caches.open(cardArtCacheName)
    const expectedPaths = new Set(allCardArtUrls)
    const requests = await cache.keys()
    cachedCount = new Set(
      requests.map((request) => new URL(request.url).pathname).filter((pathname) => expectedPaths.has(pathname))
    ).size
  }

  return {
    supported: true,
    workerState: worker?.state ?? 'missing',
    cacheName: cardArtCacheName,
    cachedCount,
    totalCount: allCardArtUrls.length,
    ready: cachedCount >= allCardArtUrls.length
  }
}

function scheduleIdle(callback: () => void): void {
  window.setTimeout(() => {
    const idleWindow = window as IdleWindow
    if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(callback, { timeout: 2_000 })
    else callback()
  }, CARD_ART_BATCH_DELAY_MS)
}

function progressivelyFill(worker: ServiceWorker, batches: string[][]): void {
  let index = 0
  const sendNext = () => {
    if (document.visibilityState !== 'visible') {
      scheduleIdle(sendNext)
      return
    }
    const urls = batches[index]
    if (!urls) return
    worker.postMessage({ type: CACHE_MESSAGE, urls })
    index += 1
    scheduleIdle(sendNext)
  }
  scheduleIdle(sendNext)
}

// Every production browser gets the runtime cache, so all modes share card art
// once fetched. Only the installed/standalone PWA fills the complete 28 MB art
// pack in the background; ordinary web visits cache cards as they encounter
// them. `enabled` is injectable so the registration flow can be unit tested
// without installing a service worker into Vite's development origin.
export async function initCardArtCache(enabled = import.meta.env.PROD): Promise<void> {
  if (!enabled || !('serviceWorker' in navigator)) return

  try {
    const workerUrl = `/card-art-sw.js?build=${encodeURIComponent(buildMeta.id)}&catalog=${encodeURIComponent(cardCatalogVersion)}`
    await navigator.serviceWorker.register(workerUrl, { scope: '/', updateViaCache: 'none' })
    const ready = await navigator.serviceWorker.ready
    const worker = ready.active
    if (worker && isStandalone()) progressivelyFill(worker, cardArtBatches(allCardArtUrls))
  } catch (error) {
    // Card art still loads normally when service workers are unavailable or
    // blocked. Keep the diagnostic secret-free and never interrupt play.
    console.warn('Card art cache unavailable', error instanceof Error ? error.name : 'unknown')
  }
}
