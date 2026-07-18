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

import { readFile, writeFile, mkdir } from 'fs/promises'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(__dir, '..')
const REPO_ROOT = join(WEB_ROOT, '..', '..')
const DATA_PATH = join(REPO_ROOT, 'packages/game-data/cards.json')
const CR_API = 'https://api.clashroyale.com/v1'

// Occasionally a new card is published by the API before its api-assets URL is
// available. Keep official Supercell fallbacks narrowly scoped and only use
// them while the API-provided image returns an error.
const OFFICIAL_ICON_FALLBACKS = new Map([
  [
    26000106,
    'https://clashroyale.inbox.supercell.com/9jtsgmsiuthj/2vhkjOKDPu5mgAFjM2uLJ0/b1c8a89dfc8bc5deeb290c6921efe77e/ronin.png'
  ]
])

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const WRITE_ONLY = args.includes('--write')
const DRY_RUN = args.includes('--dry-run')

// ── Load .env ─────────────────────────────────────────────────────────────────

const dotenv = await readFile(join(REPO_ROOT, '.env'), 'utf8').catch(() => '')
for (const line of dotenv.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq < 0) continue
  const key = trimmed.slice(0, eq).trim()
  const val = trimmed.slice(eq + 1).trim()
  if (!process.env[key]) process.env[key] = val
}

// Accept either name; CR_API_KEY is the name many devs register with.
const TOKEN = process.env.CR_API_TOKEN ?? process.env.CR_API_KEY
const MIRROR = process.env.MIRROR_IMAGES === 'true'

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

if (MIRROR) {
  await mkdir(join(WEB_ROOT, 'public/cards'), { recursive: true })
}

const cards = []

for (const card of data.items ?? []) {
  if (!('elixirCost' in card)) continue // skip supportItems that sneak in

  const idStr = String(card.id)
  let type = 'troop'
  if (idStr.startsWith('27')) type = 'building'
  else if (idStr.startsWith('28')) type = 'spell'

  const mel = card.maxEvolutionLevel ?? 0
  const evo = mel === 1 || mel === 3
  const hero = mel === 2 || mel === 3

  let icon = card.iconUrls?.medium ?? ''
  let iconEvo = card.iconUrls?.evolutionMedium ?? ''
  let iconHero = card.iconUrls?.heroMedium ?? ''

  const officialFallback = OFFICIAL_ICON_FALLBACKS.get(card.id)
  if (officialFallback && !(await imageIsAvailable(icon))) {
    console.warn(`Using official Supercell image fallback for ${card.name}; API asset is unavailable.`)
    icon = officialFallback
  }

  if (MIRROR && icon) {
    const localPath = `/cards/${card.id}.png`
    const fullPath = join(WEB_ROOT, 'public/cards', `${card.id}.png`)
    try {
      const imgRes = await fetch(icon)
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer()
        await writeFile(fullPath, Buffer.from(buf))
        icon = localPath
        process.stdout.write('.')
      }
    } catch (e) {
      console.warn(`\nFailed to mirror ${card.name}: ${e.message}`)
    }
    // Mirror evo/hero images when present
    if (iconEvo) {
      const evoPath = join(WEB_ROOT, 'public/cards', `${card.id}_evo.png`)
      try {
        const r = await fetch(iconEvo)
        if (r.ok) {
          await writeFile(evoPath, Buffer.from(await r.arrayBuffer()))
          iconEvo = `/cards/${card.id}_evo.png`
        }
      } catch {
        /* non-fatal */
      }
    }
    if (iconHero) {
      const heroPath = join(WEB_ROOT, 'public/cards', `${card.id}_hero.png`)
      try {
        const r = await fetch(iconHero)
        if (r.ok) {
          await writeFile(heroPath, Buffer.from(await r.arrayBuffer()))
          iconHero = `/cards/${card.id}_hero.png`
        }
      } catch {
        /* non-fatal */
      }
    }
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

if (existing && changelog.length === 0) {
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
    : `initial snapshot: ${candidate.count} cards`

const commitMsg = `data: refresh cards.json — ${summary}`

execSync('git add packages/game-data/cards.json', { cwd: REPO_ROOT, stdio: 'inherit' })
execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: REPO_ROOT, stdio: 'inherit' })
execSync('git push', { cwd: REPO_ROOT, stdio: 'inherit' })

console.log('\nPushed to origin — GitHub Actions will deploy.')
