/* Elixir Drop card-art service worker. This deliberately owns only /cards/*;
   navigation, API, scripts, and release updates stay network-controlled. */
const LEGACY_CARD_CACHE_PREFIX = 'elixir-drop-card-art-'
const CARD_CACHE_PREFIX = 'elixir-drop-card-art-base-'
const params = new URL(self.location.href).searchParams
const cardCacheName = `${CARD_CACHE_PREFIX}${params.get('catalog') || 'unknown'}`
const cardPath = /^\/cards\/\d+(?:_(?:evo|hero))?\.png$/
let fillQueue = Promise.resolve()

function isCardRequest(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === self.location.origin && cardPath.test(url.pathname)
}

async function fetchAndCache(request) {
  const cache = await caches.open(cardCacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function cacheBatch(urls) {
  for (const value of urls) {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin || !cardPath.test(url.pathname)) continue
    try {
      await fetchAndCache(new Request(url.href))
    } catch {
      // A later foreground request or PWA launch can retry this card.
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            // The broad legacy prefix also matches base-only caches, removing
            // both the old variant pack and superseded catalog versions.
            .filter((name) => name.startsWith(LEGACY_CARD_CACHE_PREFIX) && name !== cardCacheName)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (!isCardRequest(event.request)) return
  event.respondWith(fetchAndCache(event.request))
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-card-art' || !Array.isArray(event.data.urls)) return
  // Serialize background batches so installing the PWA never fans the entire
  // catalog out as a burst of concurrent image requests.
  fillQueue = fillQueue.then(() => cacheBatch(event.data.urls))
  event.waitUntil(fillQueue)
})
