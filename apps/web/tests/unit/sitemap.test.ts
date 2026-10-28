import { describe, expect, it } from 'vitest'
import { STATIC_PAGE_SLUGS } from '../../scripts/static-pages'
import {
  API_PAGE_PATHS,
  SITEMAP_PATHS,
  isW3cDatetime,
  readSitemapDates,
  renderSitemap,
  sitemapContentHashes
} from '../../scripts/sitemap'

describe('sitemap', () => {
  const dates = readSitemapDates()

  it('lists the home page and every generated page', () => {
    expect(SITEMAP_PATHS).toEqual(['/', ...STATIC_PAGE_SLUGS.map((slug) => `/${slug}/`)])
  })

  it('dates every page by its content: a changed page needs npm run sitemap:dates', () => {
    const hashes = sitemapContentHashes()
    for (const path of SITEMAP_PATHS) {
      if ((API_PAGE_PATHS as readonly string[]).includes(path)) continue
      expect(dates[path]?.hash, `${path} changed: run npm run sitemap:dates`).toBe(hashes[path])
    }
  })

  it('gives every URL one W3C datetime lastmod, none in the future and not all the same', () => {
    const xml = renderSitemap(dates)
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      )
    ).toBe(true)
    const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1] ?? '')
    expect(urls).toHaveLength(SITEMAP_PATHS.length)
    const lastmods = urls.map((body) => {
      expect(body).not.toMatch(/<(priority|changefreq)>/)
      const lastmod = body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]
      expect(isW3cDatetime(lastmod), body).toBe(true)
      expect(Date.parse(lastmod ?? '')).toBeLessThanOrEqual(Date.now())
      return lastmod
    })
    expect(new Set(lastmods).size).toBeGreaterThan(1)
    expect(Object.keys(dates).sort()).toEqual([...SITEMAP_PATHS].sort())
  })

  it('refuses to render a page with no date', () => {
    const rest = { ...dates }
    delete rest['/faq/']
    expect(() => renderSitemap(rest)).toThrow('/faq/')
  })
})
