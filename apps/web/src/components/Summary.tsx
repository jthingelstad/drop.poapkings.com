import type { ComponentChildren } from 'preact'
import type { GameMode } from '@elixir-drop/contracts'
import type { Insights } from '../lib/insights'
import { weakestBandLabel } from '../lib/insights'
import { earnedBadges, heldForReview, heldForReviewReference, offlineRunMode } from '../lib/use-game-run'
import { player } from '../lib/account'
import { rankFor } from '../data/starRanks'
import type { Card } from '../types'
import { CardName, ElixirCostBadge } from './CardChrome'
import Icon from './Icon'
import BadgeEarned from './BadgeEarned'
import ModeIcon from './ModeIcon'
import ShareLine from './ShareLine'
import SignInToSave from './SignInToSave'
import ReviewStatusMark from './ReviewStatus'

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
  share: { mode: GameMode; score: string }
  children?: ComponentChildren // optional mode-specific result details
  onReplay: () => void
  replayLabel?: string
  onHome: () => void
  homeLabel?: string
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
    weakestBandLabel(insights) ??
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
  share,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome,
  homeLabel = 'Home'
}: Props) {
  const { bands, weakest, slowestCards, hasTiming } = insights
  const offline = offlineRunMode.value === share.mode
  const visiblePbCallout = offline ? undefined : pbCallout
  // The arena the player is standing in, for the share card's footer. Derived
  // from XP exactly as the profile does it.
  const shareArena = player.value ? rankFor(player.value.xp ?? 0).current : undefined
  const runMoments = moments ?? defaultMoments(insights, visiblePbCallout)
  // Modes without per-card cost answers (Trade, Higher/Lower) have no bands.
  const hasBands = bands.some((b) => b.total > 0)

  return (
    <div class="ed-sum" data-summary>
      <div class="ed-sum__head">
        <div class="ed-eyebrow">
          <ModeIcon mode={share.mode} size={44} className="ed-sum__art" />
          {eyebrow}
        </div>
        <div class="ed-sum__headline">{headline}</div>
        {visiblePbCallout && (
          <div class="ed-sum__pb">
            <Icon name="star" /> {visiblePbCallout}
          </div>
        )}
        {offline && (
          <div class="ed-sum__offline" role="status">
            <Icon name="wifi-off" />
            <span>
              <strong>Offline run — not saved.</strong> Your score, badges, XP, history, and leaderboard position did
              not change. Existing device-only learning hints may still update.
            </span>
          </div>
        )}
        {/* Read straight from the signal rather than threaded through every
            mode's props: six modes render this component, and none of them
            know anything about referee state. */}
        {heldForReview.value && (
          <div class="ed-sum__review" role="status">
            <ReviewStatusMark status="pending" size={32} struck />
            <span>
              <strong>Awaiting the referee.</strong> Your score is recorded and ranks while it is checked. If the
              referee excludes it, it leaves the board and you&rsquo;ll see why here.
              {heldForReviewReference.value && (
                <small class="ed-sum__review-reference">Reference: {heldForReviewReference.value}</small>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Rungs this run cleared, read from the signal for the same reason the
          review notice is. */}
      {earnedBadges.value.length > 0 && <BadgeEarned earned={earnedBadges.value} />}

      {/* A scored result cannot omit or bury its browser-share action. Practice
          has no score or record, so it deliberately has no sharing surface. */}
      {share.mode !== 'practice' && (
        <ShareLine
          mode={share.mode}
          score={share.score}
          card={{
            bands: bands.filter((band) => band.total > 0),
            ...(player.value?.publicName ? { playerName: player.value.publicName } : {}),
            ...(shareArena ? { arenaImage: shareArena.image, arenaName: shareArena.name } : {})
          }}
        />
      )}

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

      {/* Slowest cards (timed recall and speed modes) */}
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

      {/* Optional mode-specific result details, such as the share line. */}
      {children}

      {/* Practice is deliberately unranked and has no score to save. */}
      {!offline && share.mode !== 'practice' && <SignInToSave />}

      <div class="ed-sum__actions">
        <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={onReplay}>
          <span class="tap-face">{replayLabel}</span>
        </button>
        <button class="ed-btn ed-btn--ghost tap-fx" onClick={onHome}>
          <span class="tap-face">{homeLabel}</span>
        </button>
      </div>
    </div>
  )
}
