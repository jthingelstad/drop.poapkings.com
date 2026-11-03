// Load Tinylytics only on routes that cannot contain credentials. Drop is a
// hash-routed SPA and its one-time login token lives in #/auth?...; loading a
// collector there would create an unnecessary disclosure risk.
//
// Tinylytics' script counts History API navigation (pushState, replaceState,
// popstate) but ignores a change to the hash alone, while Drop retains hash
// routing as its stable auth/share route contract. Bridge safe hash changes to
// Tinylytics' browser collector so its site view receives useful virtual
// paths. The script is never re-injected per route, so nothing counts twice.
//
// The tag is the one Tinylytics embed for every site: /js/script.js with the
// site in data-site and no query parameters. Which features it runs (events,
// beacon) is set in the site's Tinylytics settings, not here.

import { analyticsCollectorReady } from './analytics'

const SITE_ID = 'JjqvUeyEnrPM1f_iXrbU'
const EMBED_SRC = 'https://tinylytics.app/js/script.js'
const CONFIG_URL = `https://tinylytics.app/embed/${SITE_ID}/config`
const COLLECTOR_URL = `https://tinylytics.app/collector/${SITE_ID}`
const SCRIPT_ID = 'elixir-drop-tinylytics'

const PAGE_PATHS = [
  '/practice',
  '/surge',
  '/higher-lower',
  '/trade',
  '/survival',
  '/rain',
  '/leaderboards',
  '/profile',
  '/login'
] as const

// The script attaches its click listener only once it has fetched the site's
// settings (CONFIG_URL), which is after its own load event. Events queued
// before the script loaded (a game started from a direct #/surge link) are
// flushed after that fetch has finished, so the listener hears them. A
// browser without resource timing, or a settings fetch that never shows,
// falls back to a fixed delay.
const LISTENER_SETTLE_MS = 100
const LISTENER_FALLBACK_MS = 3000

function whenCollectorListening(ready: () => void): void {
  let done = false
  let observer: PerformanceObserver | undefined
  const finish = () => {
    if (done) return
    done = true
    observer?.disconnect()
    window.setTimeout(ready, LISTENER_SETTLE_MS)
  }
  try {
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name.startsWith(CONFIG_URL))) finish()
    })
    observer.observe({ type: 'resource', buffered: true })
  } catch {
    // No resource timing: the fallback below still flushes.
  }
  window.setTimeout(finish, LISTENER_FALLBACK_MS)
}

function authRoute(): boolean {
  const path = window.location.hash.split('?')[0]
  return path === '#/auth' || path.startsWith('#/auth/')
}

export function analyticsPagePath(hash = window.location.hash): string | null {
  const path = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] || '/'
  if (path === '/auth' || path.startsWith('/auth/')) return null
  if (path.startsWith('/players/')) return '/players/profile'
  return PAGE_PATHS.find((candidate) => path === candidate) ?? '/'
}

function virtualPageUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

function sendPageHit(path: string, referrer: string): void {
  try {
    if (typeof navigator.sendBeacon !== 'function') return
    const collector = new URL(COLLECTOR_URL)
    collector.searchParams.set('url', virtualPageUrl(path))
    collector.searchParams.set('path', path)
    collector.searchParams.set('referrer', referrer)
    navigator.sendBeacon(collector.toString())
  } catch {
    // Analytics is best-effort and must never interrupt navigation.
  }
}

export function initAnalytics(): () => void {
  if (typeof document === 'undefined') return () => {}

  let lastPagePath = analyticsPagePath()

  // The embed records the initial document path as `/`. Supply the virtual
  // route as well when a visitor opens a non-home hash route directly.
  if (lastPagePath && lastPagePath !== '/') sendPageHit(lastPagePath, document.referrer)

  const trackNavigation = () => {
    const nextPagePath = analyticsPagePath()
    if (!nextPagePath) {
      lastPagePath = null
      return
    }
    if (nextPagePath === lastPagePath) return

    const referrer = lastPagePath ? virtualPageUrl(lastPagePath) : document.referrer
    lastPagePath = nextPagePath

    // When leaving the auth route for Home, the newly loaded embed owns the
    // initial `/` hit. Every other hash transition needs the explicit bridge.
    if (nextPagePath === '/' && !document.getElementById(SCRIPT_ID)) return
    sendPageHit(nextPagePath, referrer)
  }

  window.addEventListener('hashchange', trackNavigation)

  const load = () => {
    if (authRoute()) return
    window.removeEventListener('hashchange', load)

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) return

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.defer = true
    script.src = EMBED_SRC
    script.dataset.site = SITE_ID
    script.addEventListener('load', () => {
      whenCollectorListening(analyticsCollectorReady)
    })
    document.head.appendChild(script)
  }

  if (authRoute()) window.addEventListener('hashchange', load)
  else load()

  return () => {
    window.removeEventListener('hashchange', trackNavigation)
    window.removeEventListener('hashchange', load)
  }
}
