/* Elixir Drop service worker.
 *
 * Two caches, deliberately separate because they expire on different clocks:
 *
 *   card art  — keyed to the CATALOG version. Card images are immutable and
 *               enormous in aggregate; they must survive an app release.
 *   app shell — keyed to the BUILD id. It must NOT survive a release, or a
 *               player is stranded on an old app with no way to know.
 *
 * The shell exists so every game works with no network. Navigation is
 * network-first, so an online player always gets the newest document and the
 * cache is only ever a fallback — the stale-build failure mode this could have
 * introduced never happens while the network is reachable.
 *
 * The API is never cached. /api-config.json in particular points at the live
 * stack, and a stale copy would aim the app at the wrong endpoint. */
const LEGACY_CARD_CACHE_PREFIX = 'elixir-drop-card-art-'
const CARD_CACHE_PREFIX = 'elixir-drop-card-art-base-'
const SHELL_CACHE_PREFIX = 'elixir-drop-shell-'
const params = new URL(self.location.href).searchParams
const cardCacheName = `${CARD_CACHE_PREFIX}${params.get('catalog') || 'unknown'}`
const shellCacheName = `${SHELL_CACHE_PREFIX}${params.get('build') || 'unknown'}`
const cardPath = /^\/cards\/\d+(?:_(?:evo|hero))?\.png$/
// Everything the app needs to boot and play offline. Card art has its own
// cache; api-config.json is excluded on purpose.
const shellPath = /^\/(?:assets\/|site\.webmanifest$|favicon|apple-touch-icon)/
const NEVER_CACHE = new Set(['/api-config.json', '/version.json', '/card-art-sw.js'])
let fillQueue = Promise.resolve()

function isCardRequest(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === self.location.origin && cardPath.test(url.pathname)
}

function isShellRequest(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  if (NEVER_CACHE.has(url.pathname)) return false
  return shellPath.test(url.pathname)
}

// Network-first: the freshest document always wins when there is a network,
// and the cached copy is strictly a fallback for when there is not.
async function shellNavigation(request) {
  const cache = await caches.open(shellCacheName)
  try {
    // Do not write a network navigation here: during a release, the retiring
    // worker serves the new document before the new worker exists. Caching it
    // under the old build would destroy the only complete offline fallback.
    // The new worker commits its own document through cacheShell only after
    // every game and every other shell dependency have loaded successfully.
    return await fetch(request)
  } catch (error) {
    const cached = await cache.match('/index.html')
    if (cached) return cached
    const previous = await previousShellMatch('/index.html')
    if (previous) return previous
    throw error
  }
}

// Cache-first for hashed build assets. The file name changes every build, so a
// stale hit is impossible; a miss just fetches and stores.
async function shellAsset(request) {
  const cache = await caches.open(shellCacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const previous = await previousShellMatch(request)
    if (previous) return previous
    throw error
  }
}

async function previousShellMatch(request) {
  const names = await caches.keys()
  for (const name of names) {
    if (!name.startsWith(SHELL_CACHE_PREFIX) || name === shellCacheName) continue
    const response = await caches.match(request, { cacheName: name })
    if (response) return response
  }
  return undefined
}

async function retirePreviousShells() {
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== shellCacheName)
      .map((name) => caches.delete(name))
  )
}

async function cacheShell(urls) {
  const cache = await caches.open(shellCacheName)
  const targets = []
  for (const value of new Set(urls)) {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin || NEVER_CACHE.has(url.pathname)) continue
    if (!shellPath.test(url.pathname) && url.pathname !== '/') continue
    targets.push({ url, key: url.pathname === '/' ? '/index.html' : new Request(url.href) })
  }

  try {
    // Fetch every byte before touching the new shell cache. The document is
    // written last, so a killed update can never advertise a partially cached
    // build. Until this completes, fetch fallback keeps using the prior shell.
    const fetched = await Promise.all(
      targets.map(async (target) => {
        const response = await fetch(target.url.href)
        if (!response.ok) throw new Error(`shell fetch failed: ${target.url.pathname}`)
        return { ...target, response }
      })
    )
    const document = fetched.find((target) => target.url.pathname === '/')
    for (const target of fetched) {
      if (target !== document) await cache.put(target.key, target.response)
    }
    if (!document) throw new Error('shell document missing')
    await cache.put(document.key, document.response)
    await retirePreviousShells()
  } catch {
    // Keep the last complete shell. A later controlled load retries this build
    // rather than trading a working offline app for a partial replacement.
  }
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
            .filter(
              (name) =>
                name.startsWith(LEGACY_CARD_CACHE_PREFIX) && name !== cardCacheName
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (isCardRequest(event.request)) {
    event.respondWith(fetchAndCache(event.request))
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(shellNavigation(event.request))
    return
  }
  if (isShellRequest(event.request)) event.respondWith(shellAsset(event.request))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-shell' && Array.isArray(event.data.urls)) {
    event.waitUntil(cacheShell(event.data.urls))
    return
  }
  if (event.data?.type !== 'cache-card-art' || !Array.isArray(event.data.urls)) return
  // Serialize background batches so installing the PWA never fans the entire
  // catalog out as a burst of concurrent image requests.
  fillQueue = fillQueue.then(() => cacheBatch(event.data.urls))
  event.waitUntil(fillQueue)
})
