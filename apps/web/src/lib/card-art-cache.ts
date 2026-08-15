import { buildMeta } from './build'
import { allCards, cardCatalogVersion } from './card-catalog'

const CARD_ART_BATCH_SIZE = 4
const CARD_ART_BATCH_DELAY_MS = 750
const WORKER_ACTIVATION_TIMEOUT_MS = 15_000
const CACHE_MESSAGE = 'cache-card-art'
const CARD_CACHE_PREFIX = 'elixir-drop-card-art-base-'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

// Every current Drop surface renders the base art. Keep Evolution and Hero
// files available in /cards, but do not make installed apps download unused
// variants as part of the offline pack.
export const allCardArtUrls = [...new Set(allCards.map((card) => card.icon))]
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

function isExpectedWorker(worker: ServiceWorker | null, workerUrl: string): worker is ServiceWorker {
  if (!worker) return false
  return new URL(worker.scriptURL, window.location.href).href === new URL(workerUrl, window.location.href).href
}

function expectedWorker(registration: ServiceWorkerRegistration, workerUrl: string): ServiceWorker | null {
  return (
    [registration.installing, registration.waiting, registration.active].find((worker) =>
      isExpectedWorker(worker, workerUrl)
    ) ?? null
  )
}

// `navigator.serviceWorker.ready` may resolve to the retiring worker while a
// new build is still installing. Wait for the exact script we just registered
// so background batches cannot be written to a cache that activation deletes.
function waitForExpectedWorker(
  registration: ServiceWorkerRegistration,
  workerUrl: string
): Promise<ServiceWorker | null> {
  return new Promise((resolve) => {
    let worker: ServiceWorker | null = null
    let settled = false

    const finish = (value: ServiceWorker | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      registration.removeEventListener('updatefound', checkRegistration)
      worker?.removeEventListener('statechange', checkWorker)
      resolve(value)
    }
    const checkWorker = () => {
      if (worker?.state === 'activated') finish(worker)
      else if (worker?.state === 'redundant') finish(null)
    }
    const checkRegistration = () => {
      const candidate = expectedWorker(registration, workerUrl)
      if (candidate !== worker) {
        worker?.removeEventListener('statechange', checkWorker)
        worker = candidate
        worker?.addEventListener('statechange', checkWorker)
      }
      checkWorker()
    }
    const timeout = window.setTimeout(() => finish(null), WORKER_ACTIVATION_TIMEOUT_MS)

    registration.addEventListener('updatefound', checkRegistration)
    checkRegistration()
  })
}

// Every production browser gets the runtime cache, so all modes share card art
// once fetched. Only the installed/standalone PWA fills the complete base-art
// pack in the background; ordinary web visits cache cards as they encounter
// them. `enabled` is injectable so the registration flow can be unit tested
// without installing a service worker into Vite's development origin.
// Every same-origin script and stylesheet this document actually loaded, plus
// the document itself. Read from the DOM rather than a build manifest so it can
// never drift from what shipped.
function shellUrls(): string[] {
  const urls = new Set<string>(['/'])
  for (const node of document.querySelectorAll<HTMLScriptElement>('script[src]')) urls.add(node.src)
  for (const node of document.querySelectorAll<HTMLLinkElement>('link[href]')) {
    const rel = node.rel
    if (rel === 'stylesheet' || rel === 'manifest' || rel === 'icon' || rel === 'apple-touch-icon') urls.add(node.href)
  }
  for (const entry of performance.getEntriesByType?.('resource') ?? []) urls.add(entry.name)
  return [...urls]
}

export function cacheAppShell(worker: ServiceWorker): void {
  worker.postMessage({ type: 'cache-shell', urls: shellUrls() })
}

export async function initCardArtCache(enabled = import.meta.env.PROD): Promise<ServiceWorker | null> {
  if (!enabled || !('serviceWorker' in navigator)) return null

  try {
    const workerUrl = `/card-art-sw.js?build=${encodeURIComponent(buildMeta.id)}&catalog=${encodeURIComponent(cardCatalogVersion)}`
    const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/', updateViaCache: 'none' })
    const worker = await waitForExpectedWorker(registration, workerUrl)
    if (worker && isStandalone()) progressivelyFill(worker, cardArtBatches(allCardArtUrls))
    return worker
  } catch (error) {
    // Card art still loads normally when service workers are unavailable or
    // blocked. Keep the diagnostic secret-free and never interrupt play.
    console.warn('Card art cache unavailable', error instanceof Error ? error.name : 'unknown')
    return null
  }
}
