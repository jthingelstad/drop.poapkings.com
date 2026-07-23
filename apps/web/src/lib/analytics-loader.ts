// Load Tinylytics only on routes that cannot contain credentials. Drop is a
// hash-routed SPA and its one-time login token lives in #/auth?...; loading a
// collector there would create an unnecessary disclosure risk.
//
// Tinylytics' SPA collector follows History API navigation, but Drop must use
// hash routing on GitHub Pages. Bridge safe hash changes to Tinylytics' browser
// collector explicitly so its Pages view receives useful virtual paths.

import { analyticsCollectorReady, flushLoginCompleted } from './analytics'

const SITE_ID = 'JjqvUeyEnrPM1f_iXrbU'
const EMBED_SRC = `https://tinylytics.app/embed/${SITE_ID}/min.js?events&beacon`
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
  '/settings',
  '/privacy',
  '/about',
  '/faq',
  '/install',
  '/login'
] as const

function authRoute(): boolean {
  const path = window.location.hash.split('?')[0]
  return path === '#/auth' || path.startsWith('#/auth/')
}

export function analyticsPagePath(hash = window.location.hash): string | null {
  const path = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] || '/'
  if (path === '/auth' || path.startsWith('/auth/')) return null
  if (path.startsWith('/players/')) return '/players/profile'
  return PAGE_PATHS.find((candidate) => path === candidate || path.startsWith(`${candidate}/`)) ?? '/'
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
    script.src = EMBED_SRC
    script.defer = true
    script.addEventListener('load', () => {
      analyticsCollectorReady()
      flushLoginCompleted()
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
