// One-time "a named release shipped" notice. Owns its own storage key, like
// account.ts and pwa-install.ts do — this is not learning progress, so it does
// not belong behind the lib/storage.ts boundary. SPEC.md §6 is the full key
// inventory.
//
// Not the UpdateBanner: that one says "this tab is running an older build,
// reload". This one says "a named release shipped, here is what changed", once
// per release, and never for a player who has not seen Drop before.

import { signal } from '@preact/signals'
import { latestRelease, type ReleaseEntry } from './releases'

// The release id the player has already been shown (or silently recorded on a
// first visit). A bare string, not JSON.
const SEEN_KEY = 'elixirdrop:releaseSeen'

export type ReleaseNoticeAction = 'show' | 'record' | 'none'

// The whole decision, as a pure function.
//
// - no releases at all      -> nothing to say
// - nothing recorded yet    -> first visit: record the current release, show
//                              nothing. A changelog popup before the player has
//                              played anything is exactly the load-time
//                              interruption CLAUDE.md rules out.
// - recorded === newest     -> already seen (or dismissed) this release
// - recorded !== newest     -> a newer named release shipped: show it once
export function decideReleaseNotice(latestId: string | null, lastSeenId: string | null): ReleaseNoticeAction {
  if (!latestId) return 'none'
  if (!lastSeenId) return 'record'
  return lastSeenId === latestId ? 'none' : 'show'
}

// The release waiting to be announced, or null. The overlay renders from this.
export const pendingRelease = signal<ReleaseEntry | null>(null)

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)?.trim() || null
  } catch {
    // Storage-disabled browsers stay quiet rather than nagging every load.
    return null
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id)
  } catch {
    // A non-persisted dismissal still closes the overlay for this session.
  }
}

export function initReleaseNotice(): void {
  const action = decideReleaseNotice(latestRelease?.id ?? null, readSeen())
  if (action === 'record' && latestRelease) writeSeen(latestRelease.id)
  if (action === 'show') pendingRelease.value = latestRelease
}

// Dismissing records the release, so it is never shown again.
export function dismissRelease(): void {
  const shown = pendingRelease.value
  pendingRelease.value = null
  if (shown) writeSeen(shown.id)
}
