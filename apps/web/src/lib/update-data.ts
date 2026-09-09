import { isUpdateTimestamp, updateMarkdownTokens } from './update-markdown.ts'

export const UPDATE_KINDS = ['feature', 'season', 'message'] as const
export type UpdateKind = (typeof UPDATE_KINDS)[number]

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
const UPDATE_KIND_SET = new Set<string>(UPDATE_KINDS)
const UPDATE_IMPACT_SET = new Set<string>(UPDATE_IMPACTS)
const UPDATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function validateUpdateEntry(value: unknown): UpdateEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Update must be an object')
  const input = value as Record<string, unknown>
  const id = requiredString(input.id, 'Update id')
  const kind = requiredString(input.kind, 'Update kind')
  const publishedAt = requiredString(input.publishedAt, 'Published timestamp')
  const title = requiredString(input.title, 'Update title')
  const body = requiredString(input.body, 'Update body')
  const impact = typeof input.impact === 'string' && input.impact.trim() ? input.impact.trim() : undefined

  if (!UPDATE_ID_PATTERN.test(id)) throw new Error(`Invalid update id: ${id}`)
  if (!UPDATE_KIND_SET.has(kind)) throw new Error(`Invalid update kind: ${kind}`)
  if (!isUpdateTimestamp(publishedAt)) throw new Error(`Invalid update timestamp: ${id}`)
  if (title.length > MAX_UPDATE_TITLE_CHARACTERS) throw new Error(`Update title is too long: ${id}`)
  if (body.split(/\s+/).length > MAX_UPDATE_BODY_WORDS) throw new Error(`Update copy is too long: ${id}`)
  if (kind === 'feature' && (!impact || !UPDATE_IMPACT_SET.has(impact))) {
    throw new Error(`Feature update needs a player-impact category: ${id}`)
  }
  if (kind !== 'feature' && impact !== undefined) {
    throw new Error(`Only feature updates carry player-impact categories: ${id}`)
  }
  updateMarkdownTokens(body)
  return {
    id,
    kind: kind as UpdateKind,
    ...(impact ? { impact: impact as UpdateImpact } : {}),
    publishedAt,
    title,
    body
  }
}

export function validateUpdateEntries(value: unknown): UpdateEntry[] {
  if (!Array.isArray(value)) throw new Error('Updates response must be a list')
  const entries = value.map(validateUpdateEntry)
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
