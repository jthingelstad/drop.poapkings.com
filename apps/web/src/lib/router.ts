// Hash router — the stable auth/share routing surface. All modes import
// { navigate } from here; App subscribes to { route }.

import { signal } from '@preact/signals'

export function parseHash(): string {
  const h = window.location.hash
  if (!h || h === '#' || h === '#/') return '/'
  return h.startsWith('#') ? h.slice(1) : h
}

export function routePathname(value: string): string {
  return value.split('?', 1)[0] || '/'
}

export function routeQuery(value: string): string {
  const separator = value.indexOf('?')
  return separator === -1 ? '' : value.slice(separator + 1)
}

const STANDALONE_HASH_ROUTES: Record<string, string> = {
  '/games': '/games/',
  '/learn-elixir-costs': '/learn-elixir-costs/',
  '/elixir-costs': '/elixir-costs/',
  '/badges': '/badges/',
  '/xp': '/xp/',
  '/discord': '/discord/',
  '/about': '/about/',
  '/updates': '/updates/',
  '/faq': '/faq/',
  '/fair-play': '/fair-play/',
  '/privacy': '/privacy/',
  '/install': '/install/'
}

function redirectStandaloneRoute(value: string): boolean {
  const path = routePathname(value)
  const destination = STANDALONE_HASH_ROUTES[path]
  if (!destination) return false
  window.location.replace(destination)
  return true
}

const initialRoute = parseHash()
export const redirectingToStandalonePage = redirectStandaloneRoute(initialRoute)
export const route = signal<string>(initialRoute)

// The route we were on before the current one — powers in-app back actions
// without relying on the history API (which we don't use).
let previousRoute = '/'

function resetRouteScroll(): void {
  window.scrollTo({ top: 0 })
  const routeScroller = document.querySelector<HTMLElement>('[data-route-scroll]')
  if (routeScroller) routeScroller.scrollTop = 0
}

window.addEventListener('hashchange', () => {
  const nextRoute = parseHash()
  if (redirectStandaloneRoute(nextRoute)) return
  previousRoute = route.peek()
  route.value = nextRoute
  resetRouteScroll()
})

export function navigate(to: string): void {
  if (parseHash() === to) {
    resetRouteScroll()
    return
  }
  window.location.hash = to
}

// Resolve a one-time routing capability without leaving it in Back history.
// This is what lets an invitation token hand off to Home or a public profile
// after its attribution has been captured.
export function replace(to: string): void {
  window.history.replaceState(null, '', `#${to}`)
  route.value = to
  resetRouteScroll()
}

// Return to wherever we came from, defaulting to Home.
export function back(fallback = '/'): void {
  const prev = previousRoute
  navigate(prev && prev !== route.peek() ? prev : fallback)
}
