import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { getCardStats } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { navigate } from '../../lib/router'
import PracticeLoop from '../practice/PracticeLoop'

const ALL_CARDS = (rawCards as CardsData).cards

// Cards you read worst: enough data, lowest accuracy first.
function weakPool(): Card[] {
  const stats = getCardStats()
  const scored = ALL_CARDS.map((c) => {
    const s = stats[String(c.id)]
    if (!s || s.seen < 2) return null
    return { c, acc: s.correct / s.seen, miss: s.missStreak }
  }).filter((x): x is { c: Card; acc: number; miss: number } => x !== null)
  scored.sort((a, b) => a.acc - b.acc || b.miss - a.miss)
  return scored.slice(0, 24).map((x) => x.c)
}

interface Filter {
  key: string
  label: string
  make: () => Card[]
}

const FILTERS: Filter[] = [
  { key: 'spells', label: 'Spells only', make: () => ALL_CARDS.filter((c) => c.type === 'spell') },
  { key: 'buildings', label: 'Buildings only', make: () => ALL_CARDS.filter((c) => c.type === 'building') },
  { key: 'troops', label: 'Troops only', make: () => ALL_CARDS.filter((c) => c.type === 'troop') },
  { key: 'cheap', label: 'Cheap · 1–2', make: () => ALL_CARDS.filter((c) => c.elixir <= 2) },
  { key: 'mid', label: 'Mid · 3–4', make: () => ALL_CARDS.filter((c) => c.elixir === 3 || c.elixir === 4) },
  { key: 'heavy', label: 'Heavy · 5+', make: () => ALL_CARDS.filter((c) => c.elixir >= 5) },
  { key: 'weak', label: 'Your weak cards', make: weakPool }
]

export default function Focus() {
  const chosen = useSignal<{ label: string; pool: Card[] } | null>(null)

  useEffect(() => {
    track('mode.focus')
  }, [])

  function choose(f: Filter) {
    let pool = f.make()
    let label = f.label
    if (pool.length < 4) {
      // Not enough cards (e.g. no weak-card history yet) — drill everything.
      pool = ALL_CARDS
      label = `${f.label} (all cards for now)`
    }
    chosen.value = { label, pool }
  }

  if (chosen.value) {
    return (
      <PracticeLoop
        pool={chosen.value.pool}
        eyebrow={`Focus · ${chosen.value.label}`}
        onExit={() => (chosen.value = null)}
      />
    )
  }

  return (
    <div class="home">
      <div class="home__hero">
        <div class="eyebrow">Focus</div>
        <h1 class="h1">Drill a subset.</h1>
        <p class="home__sub">Grind one slice of the catalog until it's automatic.</p>
      </div>

      <div class="mode-grid">
        {FILTERS.map((f) => {
          const n = f.make().length
          return (
            <button class="mode-card" key={f.key} onClick={() => choose(f)}>
              <div class="mode-card__info">
                <div class="mode-card__name">{f.label}</div>
                <div class="mode-card__desc">{n > 0 ? `${n} cards` : 'needs more practice data'}</div>
              </div>
              <span class="mode-card__arrow">→</span>
            </button>
          )
        })}
      </div>

      <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
        Back
      </button>
    </div>
  )
}
