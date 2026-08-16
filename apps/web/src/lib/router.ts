// Hash router — the only routing surface. No history API (it 404s on GitHub Pages).
// All modes import { navigate } from here; App subscribes to { route }.

import { signal } from '@preact/signals'

export function parseHash(): string {
  const h = window.location.hash
  if (!h || h === '#' || h === '#/') return '/'
  return h.startsWith('#') ? h.slice(1) : h
}

const STANDALONE_HASH_ROUTES: Record<string, string> = {
  '/games': '/games/',
  '/learn-elixir-costs': '/learn-elixir-costs/',
  '/elixir-costs': '/elixir-costs/',
  '/badges': '/badges/',
  '/discord': '/discord/',
  '/about': '/about/',
  '/releases': '/releases/',
  '/faq': '/faq/',
  '/fair-play': '/fair-play/',
  '/privacy': '/privacy/',
  '/install': '/install/'
}

function redirectStandaloneRoute(value: string): boolean {
  const path = value.split('?')[0] ?? value
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

window.addEventListener('hashchange', () => {
  const nextRoute = parseHash()
  if (redirectStandaloneRoute(nextRoute)) return
  previousRoute = route.peek()
  route.value = nextRoute
  window.scrollTo({ top: 0 })
})

export function navigate(to: string): void {
  if (parseHash() === to) {
    window.scrollTo({ top: 0 })
    return
  }
  window.location.hash = to
}

// Return to wherever we came from, defaulting to Home.
export function back(fallback = '/'): void {
  const prev = previousRoute
  navigate(prev && prev !== route.peek() ? prev : fallback)
}
