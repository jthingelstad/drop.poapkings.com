import type { ComponentChildren } from 'preact'
import type { Insights } from '../lib/insights'
import type { Card, ElixirMood } from '../types'
import ElixirHost from './ElixirHost'

export interface SummaryMoment {
  label: string
  value: string
  tone?: 'gold' | 'purple' | 'green'
}

interface Props {
  eyebrow: string // e.g. "Surge complete" / "Practice round"
  headline: string // e.g. "15 cards · 28.6s" or "12 / 15 · 80%"
  pbCallout?: string // e.g. "New personal best! −3.4s"
  elixirLine: string
  elixirMood?: ElixirMood
  insights: Insights
  moments?: SummaryMoment[]
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

function strongestBand(insights: Insights): string | null {
  const band = [...insights.bands]
    .filter((b) => b.total > 0)
    .sort((a, b) => b.correct / b.total - a.correct / a.total)[0]

  if (!band) return null
  return `${band.label} cost`
}

function weakestBand(insights: Insights): string | null {
  const band = [...insights.bands]
    .filter((b) => b.total >= 2)
    .sort((a, b) => a.correct / a.total - b.correct / b.total)[0]

  if (!band || band.correct === band.total) return null
  return `${band.label} cost`
}

function defaultMoments(insights: Insights, pbCallout?: string): SummaryMoment[] {
  const moments: SummaryMoment[] = []

  if (pbCallout) {
    moments.push({ label: 'Moment', value: pbCallout, tone: 'gold' })
  } else if (insights.accuracyPct >= 90) {
    moments.push({ label: 'Moment', value: 'Clean read', tone: 'green' })
  } else {
    moments.push({ label: 'Moment', value: `${insights.correct}/${insights.total} first try`, tone: 'purple' })
  }

  const strength = strongestBand(insights)
  if (strength) moments.push({ label: 'Best lane', value: strength, tone: 'green' })

  const focus =
    weakestBand(insights) ??
    (insights.hasTiming && insights.slowestBandLabel ? `${insights.slowestBandLabel} cost pace` : null) ??
    (insights.weakest[0] ? insights.weakest[0].name : null)

  if (focus) moments.push({ label: 'Next drill', value: focus })

  return moments.slice(0, 3)
}

export default function Summary({
  eyebrow,
  headline,
  pbCallout,
  elixirLine,
  elixirMood = 'neutral',
  insights,
  moments,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome
}: Props) {
  const { bands, weakest, slowestCards, hasTiming } = insights
  const runMoments = moments ?? defaultMoments(insights, pbCallout)

  return (
    <div class="summary">
      <div class="summary__head">
        <div class="eyebrow">{eyebrow}</div>
        <div class="summary__headline">{headline}</div>
        {pbCallout && <div class="summary__pb">{pbCallout}</div>}
      </div>

      <ElixirHost line={elixirLine} mood={elixirMood} />

      {runMoments.length > 0 && (
        <div class="summary-moments" aria-label="Run highlights">
          {runMoments.map((moment) => (
            <div class={`summary-moment summary-moment--${moment.tone ?? 'purple'}`} key={moment.label}>
              <div class="summary-moment__label">{moment.label}</div>
              <div class="summary-moment__value">{moment.value}</div>
            </div>
          ))}
        </div>
      )}

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
