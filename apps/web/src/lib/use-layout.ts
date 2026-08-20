// One initial width decision chooses the shell. Resizing the browser never
// changes that choice: the desktop arena has required dimensions and clips in
// a smaller window instead of collapsing into another interface mid-session.

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

export function isDesktop(): boolean {
  return layout.value === 'desktop'
}

// The primary-input verb for prompts — "Click" on the desktop (pointer) shell,
// "Tap" on the mobile shell, matching the two prototypes. Reactive: reads the
// layout signal, so a prompt that calls it re-renders on a layout change.
export function pointerVerb(): 'Click' | 'Tap' {
  return layout.value === 'desktop' ? 'Click' : 'Tap'
}
