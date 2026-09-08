#!/usr/bin/env node
// scripts/refresh-cards.mjs
//
// Card refresh script — run ONLY on the managed host (IP allowlisted with the CR token).
// Reads CR_API_TOKEN or CR_API_KEY from .env, fetches /cards, normalizes,
// diffs against packages/game-data/cards.json, commits + pushes if changed.
//
// Usage:
//   node scripts/refresh-cards.mjs           — full run (fetch → diff → commit → push)
//   node scripts/refresh-cards.mjs --write   — fetch + write JSON, skip git operations
//   node scripts/refresh-cards.mjs --dry-run — fetch + print changelog, no writes
//
// NEVER call this from CI or the browser. The CR token is not in CI.

import { access, readFile, writeFile, mkdir } from 'fs/promises'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { parseEnv } from 'util'

const __dir = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(__dir, '..')
const REPO_ROOT = join(WEB_ROOT, '..', '..')
const DATA_PATH = join(REPO_ROOT, 'packages/game-data/cards.json')
const CR_API = 'https://api.clashroyale.com/v1'

// Occasionally a new card is published by the API before its api-assets URL is
// available. Keep temporary published-art fallbacks narrowly scoped and only
// use them while the API-provided image returns an error. The refresh still
// vendors the image locally; the website never loads it from the fallback host.
const ICON_FALLBACKS = new Map([[26000107, 'https://cdn.royaleapi.com/static/img/cards/minion-giant.png']])

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const WRITE_ONLY = args.includes('--write')
const DRY_RUN = args.includes('--dry-run')

// ── Load .env ─────────────────────────────────────────────────────────────────

const dotenv = await readFile(join(REPO_ROOT, '.env'), 'utf8').catch(() => '')
for (const [key, val] of Object.entries(parseEnv(dotenv))) {
  if (!process.env[key]) process.env[key] = val
}

// Accept either name; CR_API_KEY is the name many devs register with.
const TOKEN = process.env.CR_API_TOKEN ?? process.env.CR_API_KEY
const MIRROR = process.env.MIRROR_IMAGES === 'true'
const writtenImagePaths = new Set()

if (!TOKEN) {
  console.error('Error: set CR_API_TOKEN (or CR_API_KEY) in .env')
  process.exit(1)
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

console.log('Fetching /cards from CR API…')
const res = await fetch(`${CR_API}/cards`, {
  headers: { Authorization: `Bearer ${TOKEN}` }
})

if (!res.ok) {
  console.error(`API error: ${res.status} ${res.statusText}`)
  const body = await res.text().catch(() => '')
  if (body) console.error(body)
  process.exit(1)
}

const data = await res.json()
console.log(`Got ${data.items?.length ?? 0} standard cards, ${data.supportItems?.length ?? 0} support items.`)

// ── Normalize ─────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10)

async function imageIsAvailable(url) {
  if (!url) return false

  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeMirroredImage(fullPath, bytes) {
  const next = Buffer.from(bytes)
  const current = await readFile(fullPath).catch(() => undefined)
  if (current?.equals(next)) return
  await writeFile(fullPath, next)
  writtenImagePaths.add(fullPath)
}

async function mirrorOptionalImage({ cardName, fullPath, kind, localPath, url }) {
  if (!url) return ''

  const existingMirror = await fileExists(fullPath)
  if (DRY_RUN) {
    if (existingMirror || (await imageIsAvailable(url))) return localPath
  } else {
    try {
      const response = await fetch(url)
      if (response.ok) {
        await writeMirroredImage(fullPath, await response.arrayBuffer())
        return localPath
      }
    } catch {
      // Fall through to the existing-mirror check and bounded warning below.
    }
    if (existingMirror) {
      console.warn(`\nFailed to refresh ${cardName} ${kind} artwork; keeping the existing mirror.`)
      return localPath
    }
  }

  console.warn(`\n${cardName} ${kind} artwork is unavailable; omitting it until the official asset is published.`)
  return ''
}

if (MIRROR && !DRY_RUN) {
  await mkdir(join(WEB_ROOT, 'public/cards'), { recursive: true })
}

// Cards whose in-game elixir cost is ambiguous — two different costs — so a
// "name the cost" game can't score them fairly. Mirror is already dropped
// automatically (the API returns no elixirCost for it); these list a single
// cost in the API but play at two, so exclude them explicitly.
const EXCLUDED_CARD_IDS = new Set([
  28000025 // Spirit Empress — two different elixir costs (Mirror-like)
])

const cards = []

for (const card of data.items ?? []) {
  if (!('elixirCost' in card)) continue // skip supportItems that sneak in
  if (EXCLUDED_CARD_IDS.has(card.id)) continue // ambiguous dual-cost cards

  const idStr = String(card.id)
  let type = 'troop'
  if (idStr.startsWith('27')) type = 'building'
  else if (idStr.startsWith('28')) type = 'spell'

  const mel = card.maxEvolutionLevel ?? 0
  let evo = mel === 1 || mel === 3
  let hero = mel === 2 || mel === 3

  let icon = card.iconUrls?.medium ?? ''
  let iconEvo = card.iconUrls?.evolutionMedium ?? ''
  let iconHero = card.iconUrls?.heroMedium ?? ''

  const iconFallback = ICON_FALLBACKS.get(card.id)
  if (iconFallback && !(await imageIsAvailable(icon))) {
    console.warn(`Using published image fallback for ${card.name}; API asset is unavailable.`)
    icon = iconFallback
  }

  if (MIRROR && icon) {
    const localPath = `/cards/${card.id}.png`
    const fullPath = join(WEB_ROOT, 'public/cards', `${card.id}.png`)
    if (!DRY_RUN) {
      try {
        const imgRes = await fetch(icon)
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer()
          await writeMirroredImage(fullPath, buf)
          process.stdout.write('.')
        }
      } catch (e) {
        console.warn(`\nFailed to mirror ${card.name}: ${e.message}`)
      }
    }
    icon = localPath
    // Mirror evo/hero images when present
    if (iconEvo) {
      const evoPath = join(WEB_ROOT, 'public/cards', `${card.id}_evo.png`)
      iconEvo = await mirrorOptionalImage({
        cardName: card.name,
        fullPath: evoPath,
        kind: 'evolution',
        localPath: `/cards/${card.id}_evo.png`,
        url: iconEvo
      })
    }
    if (iconHero) {
      const heroPath = join(WEB_ROOT, 'public/cards', `${card.id}_hero.png`)
      iconHero = await mirrorOptionalImage({
        cardName: card.name,
        fullPath: heroPath,
        kind: 'hero',
        localPath: `/cards/${card.id}_hero.png`,
        url: iconHero
      })
    }

    // The API can announce a variant before its official asset is published.
    // Keep the committed flag/artwork contract atomic so the app never exposes
    // a variant whose local image cannot ship with it.
    evo = evo && Boolean(iconEvo)
    hero = hero && Boolean(iconHero)
  }

  const entry = {
    id: card.id,
    name: card.name,
    elixir: card.elixirCost,
    rarity: (card.rarity ?? '').toLowerCase(),
    type,
    evo,
    hero,
    icon,
    ...(iconEvo ? { iconEvo } : {}),
    ...(iconHero ? { iconHero } : {})
  }

  cards.push(entry)
}

if (MIRROR) console.log() // newline after dots

// Sort by id for stable diffs
cards.sort((a, b) => a.id - b.id)

const candidate = { version: today, count: cards.length, cards }

// ── Diff ──────────────────────────────────────────────────────────────────────

let existing = null
try {
  const raw = JSON.parse(await readFile(DATA_PATH, 'utf8'))
  // Don't diff against the dev seed marker
  if (raw.version !== 'seed') existing = raw
} catch {
  // existing stays null
}

const changelog = []

if (existing) {
  const existingMap = new Map(existing.cards.map((c) => [c.id, c]))
  const candidateMap = new Map(candidate.cards.map((c) => [c.id, c]))

  for (const [id, card] of candidateMap) {
    if (!existingMap.has(id)) {
      changelog.push(`+ Added: ${card.name} (${card.elixir} elixir, ${card.type})`)
    } else {
      const old = existingMap.get(id)
      if (old.elixir !== card.elixir) {
        changelog.push(`~ Changed: ${card.name} elixir ${old.elixir} → ${card.elixir}`)
      }
      if (old.rarity !== card.rarity) {
        changelog.push(`~ Changed: ${card.name} rarity ${old.rarity} → ${card.rarity}`)
      }
      if (old.evo !== card.evo) {
        changelog.push(`~ Changed: ${card.name} evolution ${old.evo} → ${card.evo}`)
      }
      if (old.hero !== card.hero) {
        changelog.push(`~ Changed: ${card.name} hero ${old.hero} → ${card.hero}`)
      }
      if (old.icon !== card.icon || old.iconEvo !== card.iconEvo || old.iconHero !== card.iconHero) {
        changelog.push(`~ Changed: ${card.name} artwork`)
      }
    }
  }
  for (const [id, card] of existingMap) {
    if (!candidateMap.has(id)) {
      changelog.push(`- Removed: ${card.name}`)
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (existing && changelog.length === 0 && writtenImagePaths.size === 0) {
  console.log(`\nNo changes — cards.json is current (${existing.version}, ${existing.count} cards).`)
  if (!DRY_RUN && !WRITE_ONLY) process.exit(0)
}

if (changelog.length > 0) {
  console.log('\nChangelog:')
  changelog.forEach((l) => console.log(' ', l))
} else if (!existing) {
  console.log(`\nInitial snapshot: ${candidate.count} cards (${today}).`)
}

if (DRY_RUN) {
  console.log('\n[dry-run] No files written.')
  process.exit(0)
}

// ── Write ─────────────────────────────────────────────────────────────────────

await writeFile(DATA_PATH, JSON.stringify(candidate, null, 2) + '\n')
console.log(`\nWrote packages/game-data/cards.json (${candidate.count} cards, ${today})`)

if (WRITE_ONLY) {
  console.log('[--write] Skipping git operations.')
  process.exit(0)
}

// ── Commit + push ─────────────────────────────────────────────────────────────

const summary =
  changelog.length > 0
    ? changelog.slice(0, 3).join('; ') + (changelog.length > 3 ? ` (+${changelog.length - 3} more)` : '')
    : existing
      ? 'refresh mirrored card artwork'
      : `initial snapshot: ${candidate.count} cards`

const commitMsg = `data: refresh cards.json — ${summary}`

const stagedPaths = [
  'packages/game-data/cards.json',
  ...[...writtenImagePaths].map((path) => path.slice(REPO_ROOT.length + 1)).sort((a, b) => a.localeCompare(b))
]

execFileSync('git', ['add', '--', ...stagedPaths], { cwd: REPO_ROOT, stdio: 'inherit' })
execFileSync('git', ['commit', '-m', commitMsg], { cwd: REPO_ROOT, stdio: 'inherit' })
execFileSync('git', ['push'], { cwd: REPO_ROOT, stdio: 'inherit' })

console.log('\nPushed to origin — GitHub Actions will deploy.')
