// Tinylytics seam — Elixir Drop's own property (site id JjqvUeyEnrPM1f_iXrbU).
// Tinylytics accepts category.action names plus one optional string value. Keep
// values deliberately low-cardinality: modes and platform families are useful;
// player ids, emails, tags, scores, and run ids must never cross this boundary.
// Everything is best-effort so analytics can never interrupt the game loop.

import type { GameMode } from '@elixir-drop/contracts'
import { getFunnel, saveFunnel } from './storage'

export type TinyEvent =
  | 'game.started'
  | 'game.completed'
  | 'game.replayed'
  | 'game.personal_best'
  | 'game.shared'
  | 'account.login_requested'
  | 'account.login_completed'
  | 'account.profile_completed'
  | 'community.recruit_shown'
  | 'community.clan_opened'
  | 'community.discord_opened'
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
const LOGIN_COMPLETE_KEY = 'elixirdrop:analyticsLoginCompleted'
let collectorReady = false

// Mirror the funnel-relevant events into local storage (SPEC §7 funnel schema).
export function mirrorFunnel(event: TinyEvent): void {
  const f = getFunnel()
  if (event === 'community.recruit_shown') saveFunnel({ recruitShown: f.recruitShown + 1 })
  else if (event === 'community.clan_opened') saveFunnel({ recruitJoin: f.recruitJoin + 1 })
  else if (event === 'community.discord_opened') saveFunnel({ recruitDiscord: f.recruitDiscord + 1 })
  else if (event === 'game.shared') saveFunnel({ shares: f.shares + 1 })
}

// Tinylytics' browser collector records clicks on data-tinylytics-event nodes.
// Programmatic outcomes (a completed game, a successful login, an accepted
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
  mirrorFunnel(event)
  if (collectorReady) fireTinylytics(event, value)
  else pendingEvents.push({ event, value })
}

// Called by the safe loader only after the external collector has loaded.
export function analyticsCollectorReady(): void {
  collectorReady = true
  for (const pending of pendingEvents.splice(0)) fireTinylytics(pending.event, pending.value)
}

// Authentication tokens live in the hash route. Hold this event until the app
// has navigated away from #/auth so a collector can never associate it with the
// token-bearing URL.
export function queueLoginCompleted(): void {
  try {
    sessionStorage.setItem(LOGIN_COMPLETE_KEY, '1')
  } catch {
    // Losing analytics is safer than weakening the auth-route boundary.
  }
}

export function flushLoginCompleted(): void {
  try {
    if (sessionStorage.getItem(LOGIN_COMPLETE_KEY) !== '1') return
    sessionStorage.removeItem(LOGIN_COMPLETE_KEY)
    track('account.login_completed')
  } catch {
    // analytics is best-effort
  }
}
