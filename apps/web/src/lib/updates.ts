// Updates is one player-facing timeline assembled from three small, owned files:
// features, season announcements, and other POAP KINGS messages. The file is the
// category; the view remains seamless and newest-first.

import { computed } from '@preact/signals'
import { player } from './account'
import { editorialEntries, isUnread } from './update-data'

export { editorialEntries, isUnread }
export type { UpdateEntry, UpdateKind, UpdateSourceEntry } from './update-data'

export const hasUnreadUpdates = computed(() => {
  if (!player.value) return false
  const lastOpened = player.value.lastOpenedUpdates
  return editorialEntries().some((entry) => isUnread(entry.publishedAt, lastOpened))
})
