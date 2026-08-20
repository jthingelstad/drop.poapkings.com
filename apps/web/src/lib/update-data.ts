import featureData from '../data/updates/features.json' with { type: 'json' }
import seasonData from '../data/updates/seasons.json' with { type: 'json' }
import messageData from '../data/updates/messages.json' with { type: 'json' }
import { isUpdateTimestamp, updateMarkdownTokens } from './update-markdown.ts'

export type UpdateKind = 'feature' | 'season' | 'message'

export interface UpdateSourceEntry {
  id: string
  publishedAt: string
  title: string
  body: string
}

export interface UpdateEntry extends UpdateSourceEntry {
  kind: UpdateKind
}

interface UpdateFile {
  schemaVersion: number
  [key: string]: number | UpdateSourceEntry[]
}

function entriesFrom(file: UpdateFile, key: string, kind: UpdateKind): UpdateEntry[] {
  if (file.schemaVersion !== 1 || !Array.isArray(file[key])) throw new Error(`Invalid ${key} update file`)
  return (file[key] as UpdateSourceEntry[]).map((entry) => {
    if (!entry.id || !entry.title || !isUpdateTimestamp(entry.publishedAt)) {
      throw new Error(`Invalid ${kind} update: ${entry.id || '(missing id)'}`)
    }
    updateMarkdownTokens(entry.body)
    return { ...entry, kind }
  })
}

export function editorialEntries(): UpdateEntry[] {
  const entries = [
    ...entriesFrom(featureData as UpdateFile, 'features', 'feature'),
    ...entriesFrom(seasonData as UpdateFile, 'seasons', 'season'),
    ...entriesFrom(messageData as UpdateFile, 'messages', 'message')
  ]
  const ids = new Set<string>()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate update id: ${entry.id}`)
    ids.add(entry.id)
  }
  return entries.sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id)
  )
}

// A player who has never opened Updates sees everything as unread. Full
// timestamps make multiple updates on the same day behave independently.
export function isUnread(publishedAt: string, lastOpened: string | undefined): boolean {
  if (!lastOpened) return true
  return Date.parse(publishedAt) > Date.parse(lastOpened)
}
