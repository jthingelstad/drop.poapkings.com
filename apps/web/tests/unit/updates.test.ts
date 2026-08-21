import { describe, expect, it } from 'vitest'
import { editorialEntries, isUnread } from '../../src/lib/update-data'
import { renderUpdateMarkdownHtml, safeUpdateHref, updateMarkdownTokens } from '../../src/lib/update-markdown'

describe('player updates', () => {
  it('merges the three source files into one newest-first timeline', () => {
    const entries = editorialEntries()

    expect(entries).toHaveLength(67)
    expect(entries[0]).toMatchObject({
      id: 'season-135-five-board-checkpoint',
      kind: 'season'
    })
    expect(entries.some((entry) => entry.kind === 'feature')).toBe(true)
    expect(
      entries.every(
        (entry, index) => index === 0 || Date.parse(entries[index - 1]!.publishedAt) >= Date.parse(entry.publishedAt)
      )
    ).toBe(true)
  })

  it('uses full timestamps for unread state, including updates on the same day', () => {
    expect(isUnread('2026-08-19T23:35:25-05:00', undefined)).toBe(true)
    expect(isUnread('2026-08-19T23:35:25-05:00', '2026-08-19T23:30:00-05:00')).toBe(true)
    expect(isUnread('2026-08-19T23:35:25-05:00', '2026-08-19T23:40:00-05:00')).toBe(false)
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
})
