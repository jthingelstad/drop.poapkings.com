import { computed, signal } from '@preact/signals'
import { player } from './account'
import { getUpdates } from './api'
import { isUnread, validateUpdateEntries, type UpdateEntry } from './update-data'

const UPDATES_CACHE_KEY = 'elixirdrop:updates:v1'

function cachedUpdates(): UpdateEntry[] {
  try {
    const stored = localStorage.getItem(UPDATES_CACHE_KEY)
    return stored ? validateUpdateEntries(JSON.parse(stored) as unknown) : []
  } catch {
    localStorage.removeItem(UPDATES_CACHE_KEY)
    return []
  }
}

export const updateEntries = signal<UpdateEntry[]>(cachedUpdates())
export const updatesLoading = signal(false)
export const updatesError = signal('')
let refreshPromise: Promise<void> | undefined

export function editorialEntries(): UpdateEntry[] {
  return updateEntries.value
}

export function refreshUpdates(): Promise<void> {
  if (refreshPromise) return refreshPromise
  updatesLoading.value = true
  updatesError.value = ''
  refreshPromise = getUpdates()
    .then((response) => {
      const entries = validateUpdateEntries(response.entries)
      updateEntries.value = entries
      localStorage.setItem(UPDATES_CACHE_KEY, JSON.stringify(entries))
    })
    .catch(() => {
      updatesError.value = updateEntries.value.length
        ? 'Showing saved Updates while player services reconnect.'
        : 'Updates are temporarily unavailable.'
    })
    .finally(() => {
      updatesLoading.value = false
      refreshPromise = undefined
    })
  return refreshPromise
}

export { isUnread }
export type { UpdateEntry, UpdateImpact, UpdateKind, UpdateSourceEntry } from './update-data'

export const hasUnreadUpdates = computed(() => {
  if (!player.value) return false
  const lastOpened = player.value.lastOpenedUpdates
  return updateEntries.value.some((entry, index) => isUnread(entry.publishedAt, lastOpened, index))
})
