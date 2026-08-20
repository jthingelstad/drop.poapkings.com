// Tinylytics seam — Elixir Drop's own property (site id JjqvUeyEnrPM1f_iXrbU).
// Tinylytics accepts category.action names plus one optional string value. Keep
// values deliberately low-cardinality: modes and platform families are useful;
// player ids, emails, tags, scores, and run ids must never cross this boundary.
// Everything is best-effort so analytics can never interrupt the game loop.

import type { GameMode } from '@elixir-drop/contracts'

export type TinyEvent =
  | 'game.started'
  | 'game.completed'
  | 'game.replayed'
  | 'game.personal_best'
  | 'game.shared'
  | 'home.shared'
  | 'campaign.opened'
  | 'badge.shared'
  | 'install.suggestion_shown'
  | 'install.suggestion_dismissed'
  | 'install.instructions_opened'
  | 'install.prompt_accepted'
  | 'install.prompt_dismissed'
  | 'install.completed'
  | 'easter_egg.screensaver_opened'

export type TinyEventValue = GameMode | 'browser' | 'ios' | 'nav' | 'tap'

interface PendingEvent {
  event: TinyEvent
  value?: TinyEventValue
}

const pendingEvents: PendingEvent[] = []
let collectorReady = false

// Tinylytics' browser collector records clicks on data-tinylytics-event nodes.
// Programmatic browser-owned outcomes (a guest game completion or an accepted
// install prompt) have no natural click node, so use a short-lived button as the
// documented event bridge. The SPA collector's delegated listener sees the click.
function fireTinylytics(event: TinyEvent, value?: TinyEventValue): void {
  try {
    const el = document.createElement('button')
    el.type = 'button'
    el.setAttribute('data-tinylytics-event', event)
    if (value) el.setAttribute('data-tinylytics-event-value', value)
    el.setAttribute('aria-hidden', 'true')
    el.tabIndex = -1
    el.style.display = 'none'
    document.body.appendChild(el)
    el.click()
    el.remove()
  } catch {
    // analytics is best-effort — never block the game
  }
}

// Programmatic track: use for events that are NOT a real user click on a DOM element.
export function track(event: TinyEvent, value?: TinyEventValue): void {
  if (collectorReady) fireTinylytics(event, value)
  else pendingEvents.push({ event, value })
}

// Called by the safe loader only after the external collector has loaded.
export function analyticsCollectorReady(): void {
  collectorReady = true
  for (const pending of pendingEvents.splice(0)) fireTinylytics(pending.event, pending.value)
}
