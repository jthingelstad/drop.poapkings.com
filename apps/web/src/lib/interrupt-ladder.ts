import { computed, signal } from '@preact/signals'
import { route } from './router'
import { isGameRoute } from '../components/shell/nav'
import { earnedBadges } from './use-game-run'
import { updateAvailable } from './version'

// The interrupt ladder. One rule: an overlay may take the screen only if it is
// about something the player JUST DID. Exactly one thing qualifies — a badge
// earned. A new server build, an uninstalled PWA and a missing player tag are all
// true whether or not anyone is playing, so they wait to be found. Second rule
// for collisions: one at a time, and the lower tier WAITS — it does not queue.
//
//   Tier 1  badge earned      → full-screen celebration, only on a summary (8b)
//   Tier 2  milestone flash    → mid-run feedback (GameMilestone), not gated here
//   Tier 3  install prompt     → a Home banner + row (InstallPrompt), not a takeover
//   Tier 4  update ready        → a no-scrim strip above the nav pill, idle only (8a)
//   Tier 5  player tag missing  → a card at the top of Updates, never unbidden (8c)
//
// This module coordinates the two overlays that actually take screen space —
// tier 1 and tier 4. Tiers 3 and 5 are page furniture that never covers anything,
// so they sit outside the gate.
export type InterruptTier = 1 | 4

export interface InterruptContext {
  // A run or its summary is showing (a game route).
  onPlaySurface: boolean
  // A rung was just cleared — only ever true on a summary.
  badgeEarned: boolean
  updateReady: boolean
  updateDismissed: boolean
}

// The single overlay tier permitted right now, or null. A lower tier that would
// otherwise show simply loses to a higher one — it waits for the next screen
// where it is allowed, rather than queueing behind the current overlay.
export function activeInterrupt(ctx: InterruptContext): InterruptTier | null {
  // Tier 1 is the only takeover, and only on a summary: a play surface with a
  // just-earned badge. Nothing else may cover a run or a summary.
  if (ctx.badgeEarned && ctx.onPlaySurface) return 1
  if (ctx.onPlaySurface) return null
  // Idle screens: the update strip, unless the player dismissed it this session.
  if (ctx.updateReady && !ctx.updateDismissed) return 4
  return null
}

// A tier-4 update strip the player has dismissed stays gone for the session.
export const updateStripDismissed = signal(false)

export const currentInterrupt = computed<InterruptTier | null>(() =>
  activeInterrupt({
    onPlaySurface: isGameRoute(route.value),
    badgeEarned: earnedBadges.value.length > 0,
    updateReady: updateAvailable.value,
    updateDismissed: updateStripDismissed.value
  })
)
