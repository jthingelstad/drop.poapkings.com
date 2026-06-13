import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useState } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { navigate } from '../../lib/router'

const ALL_CARDS = (rawCards as CardsData).cards
const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]))
const DECK_SIZE = 8

function randomTarget(): number {
  // 2.8 – 4.5 average, the realistic deck range.
  return (Math.floor(Math.random() * 18) + 28) / 10
}

function grade(diff: number): { label: string; cls: string } {
  if (diff <= 0.05) return { label: 'Perfect', cls: 'budget-grade--perfect' }
  if (diff <= 0.15) return { label: 'Great', cls: 'budget-grade--great' }
  if (diff <= 0.3) return { label: 'Close', cls: 'budget-grade--close' }
  if (diff <= 0.5) return { label: 'Not bad', cls: 'budget-grade--ok' }
  return { label: 'Off', cls: 'budget-grade--off' }
}

function BudgetCell({ card, selected, onToggle }: { card: Card; selected: boolean; onToggle: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      class={`budget-cell${selected ? ' budget-cell--selected' : ''}`}
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={`${card.name}, ${card.elixir} elixir`}
    >
      <span class="budget-cell__cost">{card.elixir}</span>
      {card.icon && !failed ? (
        <img class="budget-cell__img" src={card.icon} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span class="budget-cell__chip">{card.name}</span>
      )}
      <span class="budget-cell__name">{card.name}</span>
    </button>
  )
}

export default function DeckBudget() {
  const target = useSignal(randomTarget())
  const selected = useSignal<number[]>([])
  const stage = useSignal<'build' | 'result'>('build')
  const best = useSignal(getRecords().deckBudgetBest)
  const isPB = useSignal(false)

  useEffect(() => {
    track('mode.deckbudget')
  }, [])

  const sel = selected.value
  const avg = sel.length ? sel.reduce((s, id) => s + (BY_ID.get(id)?.elixir ?? 0), 0) / sel.length : 0

  function toggle(id: number) {
    const cur = selected.value
    if (cur.includes(id)) selected.value = cur.filter((x) => x !== id)
    else if (cur.length < DECK_SIZE) selected.value = [...cur, id]
  }

  function score() {
    const diff = Math.abs(avg - target.value)
    const diffScore = Math.round(diff * 100)
    const prev = getRecords().deckBudgetBest
    const pb = prev === undefined || diffScore < prev
    isPB.value = pb
    if (pb) {
      saveRecords({ deckBudgetBest: diffScore })
      best.value = diffScore
      track('record.new')
    }
    stage.value = 'result'
  }

  function newDeck() {
    target.value = randomTarget()
    selected.value = []
    isPB.value = false
    stage.value = 'build'
  }

  // ── Result ───────────────────────────────────────────────────────────────
  if (stage.value === 'result') {
    const diff = Math.abs(avg - target.value)
    const g = grade(diff)
    const deck = sel.map((id) => BY_ID.get(id)).filter((c): c is Card => Boolean(c))
    return (
      <div class="main-content budget">
        <div class="budget-result">
          <div class="eyebrow">Deck Budget</div>
          <div class={`budget-result__grade ${g.cls}`}>{g.label}</div>
          <div class="budget-result__nums">
            <div>
              <div class="budget-result__big">{avg.toFixed(2)}</div>
              <div class="budget-result__cap">your average</div>
            </div>
            <div class="budget-result__vs">vs</div>
            <div>
              <div class="budget-result__big">{target.value.toFixed(1)}</div>
              <div class="budget-result__cap">target</div>
            </div>
          </div>
          <div class="budget-result__diff">
            off by {diff.toFixed(2)}
            {isPB.value
              ? ' · closest yet!'
              : best.value !== undefined
                ? ` · best ${(best.value / 100).toFixed(2)}`
                : ''}
          </div>

          <div class="budget-result__deck">
            {deck.map((c) => (
              <span class="summary-chip" key={c.id}>
                <span class="summary-chip__name">{c.name}</span>
                <span class="summary-chip__cost">
                  <span class="pl-elixir__drop" aria-hidden="true" />
                  {c.elixir}
                </span>
              </span>
            ))}
          </div>

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={newDeck}>
              New target
            </button>
            <button class="btn btn--ghost" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Build ────────────────────────────────────────────────────────────────
  const full = sel.length === DECK_SIZE
  return (
    <div class="main-content budget" style={{ gap: 16 }}>
      <div class="budget-hud">
        <div class="budget-hud__target">
          <span class="budget-hud__t-label">target avg</span>
          <span class="budget-hud__t-val">{target.value.toFixed(1)}</span>
        </div>
        <div class={`budget-hud__avg${full ? ' budget-hud__avg--ready' : ''}`}>
          <span class="budget-hud__a-val">{sel.length ? avg.toFixed(2) : '—'}</span>
          <span class="budget-hud__a-label">
            {sel.length} / {DECK_SIZE} picked
          </span>
        </div>
      </div>

      <button class="btn btn--gold budget__score" onClick={score} disabled={!full}>
        {full ? 'Score this deck' : `Pick ${DECK_SIZE - sel.length} more`}
      </button>

      <div class="budget-grid">
        {ALL_CARDS.map((c) => (
          <BudgetCell key={c.id} card={c} selected={sel.includes(c.id)} onToggle={() => toggle(c.id)} />
        ))}
      </div>
    </div>
  )
}
