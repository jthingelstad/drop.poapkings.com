// Layout switch — the redesign ships two DISTINCT layouts (not one fluid page):
// a mobile single-column shell below 1024px and a desktop 3-column shell at or
// above it. This is the single source of truth for which one renders; the shell
// is chosen at the breakpoint and re-evaluated on resize. Tablet uses desktop
// down to 1024. There is intentionally no other breakpoint JS in the app.

import { signal } from '@preact/signals'

export type Layout = 'mobile' | 'desktop'

// Matches the desktop shell's minimum; keep in sync with the CSS breakpoint token.
export const DESKTOP_MIN_WIDTH = 1024

const query = `(min-width: ${DESKTOP_MIN_WIDTH}px)`

function detect(): Layout {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
  return window.matchMedia(query).matches ? 'desktop' : 'mobile'
}

export const layout = signal<Layout>(detect())

if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia(query)
  const sync = () => {
    const next: Layout = mql.matches ? 'desktop' : 'mobile'
    if (next !== layout.value) layout.value = next
  }
  // Safari <14 only supports the deprecated addListener signature.
  if (mql.addEventListener) mql.addEventListener('change', sync)
  else mql.addListener(sync)
}

export function isDesktop(): boolean {
  return layout.value === 'desktop'
}

// The primary-input verb for prompts — "Click" on the desktop (pointer) shell,
// "Tap" on the mobile shell, matching the two prototypes. Reactive: reads the
// layout signal, so a prompt that calls it re-renders on a layout change.
export function pointerVerb(): 'Click' | 'Tap' {
  return layout.value === 'desktop' ? 'Click' : 'Tap'
}
