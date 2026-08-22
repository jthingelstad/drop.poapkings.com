import featureData from '../data/updates/features.json' with { type: 'json' }
import seasonData from '../data/updates/seasons.json' with { type: 'json' }
import messageData from '../data/updates/messages.json' with { type: 'json' }
import { isUpdateTimestamp, updateMarkdownTokens } from './update-markdown.ts'

export type UpdateKind = 'feature' | 'season' | 'message'

export const UPDATE_IMPACTS = [
  'gameplay',
  'learning',
  'competition',
  'progression',
  'access',
  'sharing',
  'identity',
  'account-privacy'
] as const
export type UpdateImpact = (typeof UPDATE_IMPACTS)[number]

export const FIRST_OPEN_UNREAD_LIMIT = 3
const MAX_UPDATE_TITLE_CHARACTERS = 55
const MAX_UPDATE_BODY_WORDS = 60
const UPDATE_IMPACT_SET = new Set<string>(UPDATE_IMPACTS)

export interface UpdateSourceEntry {
  id: string
  impact?: UpdateImpact
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
    if (entry.title.length > MAX_UPDATE_TITLE_CHARACTERS) {
      throw new Error(`Update title is too long: ${entry.id}`)
    }
    if (entry.body.trim().split(/\s+/).length > MAX_UPDATE_BODY_WORDS) {
      throw new Error(`Update copy is too long: ${entry.id}`)
    }
    if (kind === 'feature' && (!entry.impact || !UPDATE_IMPACT_SET.has(entry.impact))) {
      throw new Error(`Feature update needs a player-impact category: ${entry.id}`)
    }
    if (kind !== 'feature' && entry.impact !== undefined) {
      throw new Error(`Only feature updates carry player-impact categories: ${entry.id}`)
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

// On a first open, only the newest few cards earn the unread treatment; the
// complete archive remains available but does not arrive as an expanded wall.
// Full timestamps make multiple updates on the same day behave independently.
export function isUnread(publishedAt: string, lastOpened: string | undefined, entryIndex: number): boolean {
  if (!lastOpened) return entryIndex < FIRST_OPEN_UNREAD_LIMIT
  return Date.parse(publishedAt) > Date.parse(lastOpened)
}
