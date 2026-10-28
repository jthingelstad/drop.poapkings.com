// The sitemap, generated at build so every <lastmod> says when that page's content last really
// changed. A page's content is reduced to a hash (sitemapContentHashes); sitemap-dates.json records
// each page's hash and the time it last changed. The unit test fails when a page's content no longer
// matches its recorded hash, and `npm run sitemap:dates` re-stamps exactly the pages that changed.
// The build never stamps its own clock, so a deploy that changes no page moves no date.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderStaticPage, STATIC_PAGE_SLUGS } from './static-pages.ts'

const SITE_URL = 'https://drop.poapkings.com'
const WEB_ROOT = join(import.meta.dirname, '..')
export const SITEMAP_DATES_PATH = join(WEB_ROOT, 'sitemap-dates.json')

// /updates/ is rendered by the API from the published Updates, not by this build: its date is the
// newest publication, refreshed from the live feed by `npm run sitemap:dates`.
export const API_PAGE_PATHS = ['/updates/'] as const

export const SITEMAP_PATHS: readonly string[] = ['/', ...STATIC_PAGE_SLUGS.map((slug) => `/${slug}/`)]

export interface SitemapDate {
  lastmod: string
  hash?: string
}
export type SitemapDates = Record<string, SitemapDate>

const W3C_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

// What a reader of a generated page sees: its title, description and <main>. The site-wide nav and
// footer are left out, so a nav change does not mark every page changed.
export function staticPageContent(html: string): string {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? ''
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? html
  return `${title}\n${description}\n${main}`
}

// The home page is the app shell: its HTML (less the Content-Security-Policy, which no reader sees)
// and the Home screen's source.
function homeSources(): string {
  const files = [
    'index.html',
    'src/screens/Home.tsx',
    ...readdirSync(join(WEB_ROOT, 'src/screens/home'))
      .sort()
      .map((file) => `src/screens/home/${file}`)
  ]
  return files
    .map((file) => {
      const source = readFileSync(join(WEB_ROOT, file), 'utf8')
      return `${file}\n${file === 'index.html' ? source.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '') : source}`
    })
    .join('\n')
}

export function sitemapContentHashes(): Record<string, string> {
  const hashes: Record<string, string> = { '/': sha256(homeSources()) }
  for (const slug of STATIC_PAGE_SLUGS) {
    const path = `/${slug}/`
    if ((API_PAGE_PATHS as readonly string[]).includes(path)) continue
    hashes[path] = sha256(staticPageContent(renderStaticPage(slug)))
  }
  return hashes
}

export function readSitemapDates(): SitemapDates {
  return JSON.parse(readFileSync(SITEMAP_DATES_PATH, 'utf8')) as SitemapDates
}

export function isW3cDatetime(value: string | undefined): boolean {
  return !!value && W3C_DATETIME.test(value) && !Number.isNaN(Date.parse(value))
}

export function renderSitemap(dates: SitemapDates = readSitemapDates()): string {
  const urls = SITEMAP_PATHS.map((path) => {
    const lastmod = dates[path]?.lastmod
    if (!isW3cDatetime(lastmod))
      throw new Error(`sitemap: ${path} has no lastmod in sitemap-dates.json (npm run sitemap:dates)`)
    return `  <url><loc>${SITE_URL}${path}</loc><lastmod>${lastmod}</lastmod></url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}
