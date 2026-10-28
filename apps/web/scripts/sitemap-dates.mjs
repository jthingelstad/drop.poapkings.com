#!/usr/bin/env node
// Re-stamps sitemap-dates.json: a page whose content hash changed gets the current time, every other
// page keeps its date, and /updates/ takes the newest publication from the live feed (a read-only GET).
//
//   npm run sitemap:dates            — update sitemap-dates.json
//   npm run sitemap:dates -- --check — exit 1 when a page's content no longer matches its date
//   npm run sitemap:dates -- --pages — the generated pages only, leaving /updates/ (refresh-cards uses it)
//
// The unit test runs the same check, so a content change cannot land without its date.
import { writeFileSync } from 'node:fs'
import { API_PAGE_PATHS, SITEMAP_DATES_PATH, readSitemapDates, sitemapContentHashes } from './sitemap.ts'

const CHECK = process.argv.includes('--check')
const PAGES_ONLY = process.argv.includes('--pages')
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const dates = readSitemapDates()
const changed = []

for (const [path, hash] of Object.entries(sitemapContentHashes())) {
  if (dates[path]?.hash === hash) continue
  changed.push(path)
  dates[path] = { lastmod: now, hash }
}

if (CHECK) {
  if (changed.length) {
    console.error(`sitemap: content changed without a new date: ${changed.join(', ')} (npm run sitemap:dates)`)
    process.exit(1)
  }
  console.log('sitemap: every page date matches its content')
  process.exit(0)
}

for (const path of PAGES_ONLY ? [] : API_PAGE_PATHS) {
  const feed = await fetch('https://drop.poapkings.com/feed.xml').then((response) => {
    if (!response.ok) throw new Error(`feed.xml: HTTP ${response.status}`)
    return response.text()
  })
  const newest = feed.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/)?.[1]
  if (!newest) throw new Error('feed.xml has no lastBuildDate')
  const lastmod = new Date(newest).toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (dates[path]?.lastmod !== lastmod) changed.push(path)
  dates[path] = { lastmod }
}

writeFileSync(SITEMAP_DATES_PATH, `${JSON.stringify(dates, null, 2)}\n`)
console.log(changed.length ? `sitemap: re-dated ${changed.join(', ')}` : 'sitemap: no page changed')
