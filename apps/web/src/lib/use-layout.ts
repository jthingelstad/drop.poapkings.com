// Layout switch — the redesign ships ONE phone-column layout. On mobile it is
// the full-bleed shell; at or above 1024px the same column is centered and
// letterboxed on the dark field, with a slim aside in the margin. This signal is
// the single source of truth for "are we letterboxing?"; it is read at the
// breakpoint and re-evaluated on resize. Tablet uses the desktop letterbox down
// to 1024. There is intentionally no other breakpoint JS in the app.
//
// The letterbox is a WIDTH decision. Whether RANKED play is allowed is a
// separate INPUT decision (supportsTouchPlay, below): ranked is timed to the
// millisecond and plays on touch, so a touchscreen desktop can still rank while
// a mouse-only laptop is held to Practice — independent of this breakpoint.

import { signal } from '@preact/signals'
import { gamePathForRoute } from './game-routes'

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

// Whether the device can play a ranked run. Ranked timing is fair only on touch,
// so this gates the five ranked modes (Practice stays open everywhere). It is
// purely input-based — a coarse pointer or any touch points — and deliberately
// independent of the width breakpoint above: a touchscreen desktop passes, a
// mouse-only widescreen does not. Not reactive; input capability does not change
// mid-session, and a static read keeps SSR/tests deterministic.
export function supportsTouchPlay(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || (navigator.maxTouchPoints ?? 0) > 0
}

// Whether a route lands on the ranked touch-only gate. App renders the gate from
// this and the shell reads it to keep the ambient wallpaper off: nothing drifts
// behind a screen that is asking for a decision. One predicate, so the two can
// never disagree about which screen is the gate.
export function isRankedTouchGate(value: string): boolean {
  const gamePath = gamePathForRoute(value)
  return Boolean(gamePath) && gamePath !== '/practice' && !supportsTouchPlay()
}

// The primary-input verb for prompts — "Click" on the desktop (pointer) shell,
// "Tap" on the mobile shell, matching the two prototypes. Reactive: reads the
// layout signal, so a prompt that calls it re-renders on a layout change.
export function pointerVerb(): 'Click' | 'Tap' {
  return layout.value === 'desktop' ? 'Click' : 'Tap'
}
