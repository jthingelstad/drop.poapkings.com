import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUpdates } from '../../src/lib/api'
import { FIRST_OPEN_UNREAD_LIMIT, UPDATE_IMPACTS, isUnread, validateUpdateEntries } from '../../src/lib/update-data'
import { renderUpdateMarkdownHtml, safeUpdateHref, updateMarkdownTokens } from '../../src/lib/update-markdown'
import { refreshUpdates, updateEntries, updatesError, updatesLoading } from '../../src/lib/updates'
import { renderUpdatesFeed } from '../../scripts/static-pages'

vi.mock('../../src/lib/api', () => ({ getUpdates: vi.fn() }))

const entries = [
  {
    id: 'older-feature',
    kind: 'feature' as const,
    impact: 'learning' as const,
    publishedAt: '2026-08-20T12:00:00Z',
    title: 'Older feature',
    body: 'Learn with **bounded Markdown**.'
  },
  {
    id: 'newer-season',
    kind: 'season' as const,
    publishedAt: '2026-09-08T12:00:00Z',
    title: 'Newer season',
    body: 'Higher / Lower carries the Free Pass.'
  }
]

beforeEach(() => {
  vi.mocked(getUpdates).mockReset()
  updateEntries.value = []
  updatesError.value = ''
  updatesLoading.value = false
})

describe('player updates', () => {
  it('validates API records and sorts them newest first', () => {
    const validated = validateUpdateEntries(entries)

    expect(validated.map(({ id }) => id)).toEqual(['newer-season', 'older-feature'])
    expect(UPDATE_IMPACTS).toContain(validated[1]?.impact)
    expect(() => validateUpdateEntries([{ ...entries[0], impact: undefined }])).toThrow(
      'Feature update needs a player-impact category'
    )
  })

  it('bounds first-open unread cards and uses full timestamps after that', () => {
    expect(isUnread('2026-08-19T23:35:25-05:00', undefined, FIRST_OPEN_UNREAD_LIMIT - 1)).toBe(true)
    expect(isUnread('2026-08-19T23:35:25-05:00', undefined, FIRST_OPEN_UNREAD_LIMIT)).toBe(false)
    expect(isUnread('2026-08-19T23:35:25-05:00', '2026-08-19T23:30:00-05:00', 20)).toBe(true)
    expect(isUnread('2026-08-19T23:35:25-05:00', '2026-08-19T23:40:00-05:00', 0)).toBe(false)
  })

  it('renders the small Markdown vocabulary used by update copy', () => {
    expect(renderUpdateMarkdownHtml('A **bold** move with [a route](/#/practice) and `code`.')).toBe(
      'A <strong>bold</strong> move with <a href="/#/practice">a route</a> and <code>code</code>.'
    )
  })

  it('rejects multi-paragraph, raw HTML, and unsafe-link copy', () => {
    expect(() => updateMarkdownTokens('One.\n\nTwo.')).toThrow('exactly one paragraph')
    expect(() => updateMarkdownTokens('<strong>raw HTML</strong>')).toThrow('html')
    expect(() => updateMarkdownTokens('[bad](javascript:alert(1))')).toThrow('unsupported destination')
    expect(safeUpdateHref('//example.com')).toBeUndefined()
    expect(safeUpdateHref('https://poapkings.com')).toBe('https://poapkings.com')
  })

  it('refreshes from the API and keeps a validated local fallback', async () => {
    vi.mocked(getUpdates).mockResolvedValue({ entries })

    await refreshUpdates()

    expect(updateEntries.value.map(({ id }) => id)).toEqual(['newer-season', 'older-feature'])
    expect(JSON.parse(localStorage.getItem('elixirdrop:updates:v1') ?? '[]')).toHaveLength(2)
    expect(updatesError.value).toBe('')
    expect(updatesLoading.value).toBe(false)

    vi.mocked(getUpdates).mockRejectedValue(new Error('offline'))
    await refreshUpdates()
    expect(updateEntries.value).toHaveLength(2)
    expect(updatesError.value).toContain('Showing saved Updates')
  })

  it('generates a valid empty RSS fallback for local and origin failures', () => {
    const document = new DOMParser().parseFromString(renderUpdatesFeed(), 'application/xml')

    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.querySelector('channel > title')?.textContent).toBe('Elixir Drop Updates')
    expect(document.querySelector('channel > link')?.textContent).toBe('https://drop.poapkings.com/updates/')
    expect(document.querySelectorAll('item')).toHaveLength(0)
  })
})
