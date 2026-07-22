// Hash router — the only routing surface. No history API (it 404s on GitHub Pages).
// All modes import { navigate } from here; App subscribes to { route }.

import { signal } from '@preact/signals'

export function parseHash(): string {
  const h = window.location.hash
  if (!h || h === '#' || h === '#/') return '/'
  return h.startsWith('#') ? h.slice(1) : h
}

export const route = signal<string>(parseHash())

// The route we were on before the current one — powers the meta-page back arrow
// without relying on the history API (which we don't use).
let previousRoute = '/'

window.addEventListener('hashchange', () => {
  previousRoute = route.peek()
  route.value = parseHash()
  window.scrollTo({ top: 0 })
})

export function navigate(to: string): void {
  if (parseHash() === to) {
    window.scrollTo({ top: 0 })
    return
  }
  window.location.hash = to
}

// Return to wherever we came from, defaulting to Home. Falls back to Home when
// the previous route was itself a meta page (avoids bouncing between them).
export function back(fallback = '/'): void {
  const prev = previousRoute
  navigate(prev && prev !== route.peek() ? prev : fallback)
}
