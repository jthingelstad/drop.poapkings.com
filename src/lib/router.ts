// Hash router — the only routing surface. No history API (it 404s on GitHub Pages).
// All modes import { navigate } from here; App subscribes to { route }.

import { signal } from '@preact/signals'

export function parseHash(): string {
  const h = window.location.hash
  if (!h || h === '#' || h === '#/') return '/'
  return h.startsWith('#') ? h.slice(1) : h
}

export const route = signal<string>(parseHash())

window.addEventListener('hashchange', () => {
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
