import type { ComponentChildren } from 'preact'
import type { Insights } from '../lib/insights'
import type { Card, ElixirMood } from '../types'
import ElixirHost from './ElixirHost'

interface Props {
  eyebrow: string // e.g. "Surge complete" / "Practice round"
  headline: string // e.g. "15 cards · 28.6s" or "12 / 15 · 80%"
  pbCallout?: string // e.g. "New personal best! −3.4s"
  elixirLine: string
  elixirMood?: ElixirMood
  insights: Insights
  children?: ComponentChildren // share line + recruit CTA slot
  onReplay: () => void
  replayLabel?: string
  onHome: () => void
}

function CardChip({ card, sub }: { card: Card; sub?: string }) {
  return (
    <span class="summary-chip">
      <span class="summary-chip__name">{card.name}</span>
      <span class="summary-chip__cost">
        <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
        {card.elixir}
      </span>
      {sub && <span class="summary-chip__sub">{sub}</span>}
    </span>
  )
}

export default function Summary({
  eyebrow,
  headline,
  pbCallout,
  elixirLine,
  elixirMood = 'neutral',
  insights,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome
}: Props) {
  const { bands, weakest, slowestCards, hasTiming } = insights

  return (
    <div class="summary">
      <div class="summary__head">
        <div class="eyebrow">{eyebrow}</div>
        <div class="summary__headline">{headline}</div>
        {pbCallout && <div class="summary__pb">{pbCallout}</div>}
      </div>

      <ElixirHost line={elixirLine} mood={elixirMood} />

      {/* Accuracy by cost band */}
      <div class="summary__section">
        <div class="summary__label">Accuracy by cost</div>
        <div class="band-row">
          {bands.map((b) => {
            const pct = b.total > 0 ? Math.round((b.correct / b.total) * 100) : null
            return (
              <div class="band" key={b.label}>
                <div class="band__bar">
                  <div class="band__fill" style={{ height: `${pct ?? 0}%` }} />
                </div>
                <div class="band__pct">{pct === null ? '—' : `${pct}%`}</div>
                <div class="band__label">{b.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Weakest cards */}
      {weakest.length > 0 && (
        <div class="summary__section">
          <div class="summary__label">Missed this round</div>
          <div class="summary__chips">
            {weakest.slice(0, 5).map((c) => (
              <CardChip card={c} key={c.id} />
            ))}
          </div>
        </div>
      )}

      {/* Slowest cards (Surge) */}
      {hasTiming && slowestCards && slowestCards.length > 0 && (
        <div class="summary__section">
          <div class="summary__label">Slowest reads</div>
          <div class="summary__chips">
            {slowestCards.map((c) => (
              <CardChip card={c} key={c.id} />
            ))}
          </div>
        </div>
      )}

      {/* Share line / recruit CTA slot */}
      {children}

      {/* Kudos — Tinylytics fills this in (?kudos in the embed) */}
      <div class="summary__kudos">
        <button class="tinylytics_kudos btn btn--ghost btn--sm" aria-label="Give kudos" />
        <span class="summary__kudos-hint">Was this fun?</span>
      </div>

      <div class="summary__actions">
        <button class="btn btn--gold" onClick={onReplay}>
          {replayLabel}
        </button>
        <button class="btn btn--ghost" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  )
}
