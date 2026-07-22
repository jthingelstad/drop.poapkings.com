import type { ComponentChildren } from 'preact'
import type { Insights } from '../lib/insights'
import type { Card } from '../types'
import { CardName, ElixirCostBadge } from './CardChrome'
import Icon from './Icon'
import SignInToSave from './SignInToSave'

export interface SummaryMoment {
  label: string
  value: string
  tone?: 'gold' | 'purple' | 'green'
}

interface Props {
  eyebrow: string // e.g. "Surge complete" / "Practice round"
  headline: string // e.g. "28.6s" or "12 / 15 · 80%"
  pbCallout?: string // e.g. "New personal best! −3.4s"
  insights: Insights
  moments?: SummaryMoment[]
  children?: ComponentChildren // share line + recruit CTA slot
  onReplay: () => void
  replayLabel?: string
  onHome: () => void
}

function CardChip({ card, sub }: { card: Card; sub?: string }) {
  return (
    <span class="ed-sum-chip">
      <CardName card={card} className="ed-sum-chip__name" />
      <ElixirCostBadge elixir={card.elixir} className="ed-sum-chip__cost" />
      {sub && <span class="ed-sum-chip__sub">{sub}</span>}
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
  insights,
  moments,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome
}: Props) {
  const { bands, weakest, slowestCards, hasTiming } = insights
  const runMoments = moments ?? defaultMoments(insights, pbCallout)
  // Modes without per-card cost answers (Trade, Higher/Lower) have no bands.
  const hasBands = bands.some((b) => b.total > 0)

  return (
    <div class="ed-sum" data-summary>
      <div class="ed-sum__head">
        <div class="ed-eyebrow">{eyebrow}</div>
        <div class="ed-sum__headline">{headline}</div>
        {pbCallout && (
          <div class="ed-sum__pb">
            <Icon name="star" /> {pbCallout}
          </div>
        )}
      </div>

      {runMoments.length > 0 && (
        <div class="ed-sum-tiles" aria-label="Run highlights">
          {runMoments.map((moment) => (
            <div class={`ed-sum-tile ed-sum-tile--${moment.tone ?? 'purple'}`} key={moment.label}>
              <div class="ed-sum-tile__label">{moment.label}</div>
              <div class="ed-sum-tile__value">{moment.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Accuracy by cost band (only for modes that answer per-card costs) */}
      {hasBands && (
        <div class="ed-sum-bands">
          <div class="ed-sum__label">Accuracy by cost</div>
          <div class="ed-sum-bandrow">
            {bands.map((b) => {
              const pct = b.total > 0 ? Math.round((b.correct / b.total) * 100) : null
              return (
                <div class="ed-sum-band" key={b.label}>
                  <div class="ed-sum-band__bar">
                    <div class="ed-sum-band__fill" style={{ height: `${pct ?? 0}%` }} />
                  </div>
                  <div class="ed-sum-band__label">{b.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Weakest cards */}
      {weakest.length > 0 && (
        <div class="ed-sum-section">
          <div class="ed-sum__label">Missed this round</div>
          <div class="ed-sum-chips">
            {weakest.slice(0, 5).map((c) => (
              <CardChip card={c} key={c.id} />
            ))}
          </div>
        </div>
      )}

      {/* Slowest cards (Surge) */}
      {hasTiming && slowestCards && slowestCards.length > 0 && (
        <div class="ed-sum-section">
          <div class="ed-sum__label">Slowest reads</div>
          <div class="ed-sum-chips">
            {slowestCards.map((c) => (
              <CardChip card={c} key={c.id} />
            ))}
          </div>
        </div>
      )}

      {/* Share line / recruit CTA slot */}
      {children}

      {/* Signed-out players played as a guest — invite them to save the score. */}
      <SignInToSave />

      <div class="ed-sum__actions">
        <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={onReplay}>
          <span class="tap-face">{replayLabel}</span>
        </button>
        <button class="ed-btn ed-btn--ghost tap-fx" onClick={onHome}>
          <span class="tap-face">Home</span>
        </button>
      </div>
    </div>
  )
}
