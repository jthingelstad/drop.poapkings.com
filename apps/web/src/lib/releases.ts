// Typed view of the committed release history (`src/data/releases.json`).
// That file is written by `scripts/cut-release.mjs` during `npm run
// release:cut` — nobody edits it by hand, and GitHub Releases remain the
// canonical history. A JSON import carries no type, so assert its shape once
// here (card-catalog.ts precedent) for the /releases page and the one-time
// release notice.

import raw from '../data/releases.json'

export interface ReleaseEntry {
  // The release tag slug ("radiant-royal-giant") — stable and unique per cut.
  id: string
  // The coined alliterative Clash Royale card name.
  name: string
  // ISO date (YYYY-MM-DD) the release was cut, America/Chicago.
  date: string
  // Short build sha of the already-live commit the release was cut from.
  build: string
  // The player-facing subject line the cut authored.
  headline: string
  // Short player-facing paragraphs, flattened from the same player tier.
  notes: string[]
  // True only for the pre-1.0 entries backfilled from shipped history. Those
  // builds really did go live on those dates (every push to main deploys), but
  // they were never named, tagged, or mailed at the time — so the page labels
  // them rather than letting them pose as cut releases. `cut-release.mjs` never
  // sets this, so every real cut is unmarked.
  beta?: boolean
}

interface ReleasesFile {
  schemaVersion: number
  releases: ReleaseEntry[]
}

// Newest first — the cut tool writes the list in that order.
export const releases: ReleaseEntry[] = (raw as ReleasesFile).releases

export const latestRelease: ReleaseEntry | null = releases[0] ?? null

export function releaseDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
