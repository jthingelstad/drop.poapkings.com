// The Updates view is a merged VIEW, not a mailbox. Four sources feed it:
//   1. releases.json   — named releases (editorial, static)
//   2. messages.json   — editorial notes (static)
//   3. runs the referee has touched — derived on-device from reviewStatus
//   4. rungs cleared   — derived from badge state
// (3) and (4) are built in the Updates component from live signals and only
// POINT at where the data already lives (the run sheet, the badge sheet). This
// module owns the editorial timeline (1 + 2) and the single unread signal.

import { computed } from '@preact/signals'
import { player } from './account'
import { releases } from './releases'
import { messages } from './messages'

export interface UpdateEntry {
  id: string
  kind: 'release' | 'message'
  // YYYY-MM-DD.
  date: string
  title: string
  body: string[]
}

// Releases + messages, newest first. Static JSON only — no per-player content.
export function editorialEntries(): UpdateEntry[] {
  const fromReleases: UpdateEntry[] = releases.map((release) => ({
    id: `release-${release.id}`,
    kind: 'release',
    date: release.date,
    title: release.headline,
    body: release.notes
  }))
  const fromMessages: UpdateEntry[] = messages.map((message) => ({
    id: `message-${message.id}`,
    kind: 'message',
    date: message.date,
    title: message.title,
    body: message.body
  }))
  return [...fromReleases, ...fromMessages].sort((left, right) => right.date.localeCompare(left.date))
}

// A dated item is unread when it is newer than the last time Updates was opened.
// A player who has never opened Updates sees everything as unread.
export function isUnread(date: string, lastOpened: string | undefined): boolean {
  if (!lastOpened) return true
  return date > lastOpened.slice(0, 10)
}

// The single unread signal the You pill and the Updates scope tab both read. It
// is driven by the dated editorial sources; the referee slot and rung rows are
// always-visible content in the view, not unread triggers, because they carry no
// timestamp to compare.
export const hasUnreadUpdates = computed(() => {
  if (!player.value) return false
  const lastOpened = player.value.lastOpenedUpdates
  return editorialEntries().some((entry) => isUnread(entry.date, lastOpened))
})
