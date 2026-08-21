import { describe, expect, it } from 'vitest'
import { editorialEntries, isUnread } from '../../src/lib/update-data'
import { renderUpdateMarkdownHtml, safeUpdateHref, updateMarkdownTokens } from '../../src/lib/update-markdown'
import { renderUpdatesFeed } from '../../scripts/static-pages'

describe('player updates', () => {
  it('merges the three source files into one newest-first timeline', () => {
    const entries = editorialEntries()

    expect(entries).toHaveLength(69)
    expect(entries[0]).toMatchObject({ id: 'updates-rss-feed', kind: 'feature' })
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

  it('renders one valid RSS item per update from all three streams', () => {
    const entries = editorialEntries()
    const xml = renderUpdatesFeed()
    const document = new DOMParser().parseFromString(xml, 'application/xml')

    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.querySelector('channel > title')?.textContent).toBe('Elixir Drop Updates')
    expect(document.querySelector('channel > link')?.textContent).toBe('https://drop.poapkings.com/updates/')

    const items = [...document.querySelectorAll('item')]
    expect(items).toHaveLength(entries.length)
    expect(items[0]?.querySelector('title')?.textContent).toBe(entries[0]?.title)
    expect(items[0]?.querySelector('guid')?.textContent).toBe(`https://drop.poapkings.com/updates/#${entries[0]?.id}`)
    expect(items[0]?.querySelector('pubDate')?.textContent).toBe(new Date(entries[0]!.publishedAt).toUTCString())
    expect(items[0]?.querySelector('description')?.textContent).toContain('https://drop.poapkings.com/feed.xml')
    expect(new Set(items.map((item) => item.querySelector('category')?.textContent))).toEqual(
      new Set(['Feature', 'Season', 'Message'])
    )
  })
})
