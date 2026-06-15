// Tinylytics seam — Elixir Drop's OWN property (site id JjqvUeyEnrPM1f_iXrbU).
// Events follow Tinylytics' category.action naming and fire via data-tinylytics-event.
// Everything here is best-effort: the local funnel mirror is the source of truth for
// the game's own logic, so analytics never throws into the game loop.

import { getFunnel, saveFunnel } from './storage'

declare global {
  interface Window {
    tinylytics?: { triggerUpdate?: () => void }
  }
}

export type TinyEvent =
  | 'game.start'
  | 'mode.practice'
  | 'mode.identify'
  | 'mode.surge'
  | 'mode.higherlower'
  | 'mode.trade'
  | 'mode.blitz'
  | 'mode.survival'
  | 'mode.ladder'
  | 'mode.endless'
  | 'mode.costsweep'
  | 'identify.complete'
  | 'surge.complete'
  | 'ladder.complete'
  | 'trade.complete'
  | 'endless.complete'
  | 'costsweep.complete'
  | 'record.new'
  | 'recruit.shown'
  | 'recruit.join'
  | 'recruit.discord'
  | 'result.share'

// Mirror the funnel-relevant events into local storage (SPEC §7 funnel schema).
export function mirrorFunnel(event: TinyEvent): void {
  const f = getFunnel()
  if (event === 'recruit.shown') saveFunnel({ recruitShown: f.recruitShown + 1 })
  else if (event === 'recruit.join') saveFunnel({ recruitJoin: f.recruitJoin + 1 })
  else if (event === 'recruit.discord') saveFunnel({ recruitDiscord: f.recruitDiscord + 1 })
  else if (event === 'result.share') saveFunnel({ shares: f.shares + 1 })
}

// Fire a Tinylytics custom event from code. Tinylytics delegates clicks and reads
// the nearest [data-tinylytics-event], so we synthesize a bubbling click on a hidden
// element. triggerUpdate() nudges the embed to (re)bind on SPA navigations.
function fireTinylytics(event: TinyEvent): void {
  try {
    const el = document.createElement('span')
    el.setAttribute('data-tinylytics-event', event)
    el.setAttribute('aria-hidden', 'true')
    el.style.display = 'none'
    document.body.appendChild(el)
    window.tinylytics?.triggerUpdate?.()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    setTimeout(() => el.remove(), 200)
  } catch {
    // analytics is best-effort — never block the game
  }
}

// Programmatic track: use for events that are NOT a real user click on a DOM element.
export function track(event: TinyEvent): void {
  mirrorFunnel(event)
  fireTinylytics(event)
}
