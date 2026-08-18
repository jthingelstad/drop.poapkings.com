import type { ComponentChildren } from 'preact'
import type { GameMode } from '@elixir-drop/contracts'
import type { Insights } from '../lib/insights'
import { earnedBadges, earnedXp, heldForReview, heldForReviewReference, offlineRunMode } from '../lib/use-game-run'
import { player } from '../lib/account'
import { rankFor } from '../data/starRanks'
import type { Card } from '../types'
import { CardName, ElixirCostBadge } from './CardChrome'
import Icon from './Icon'
import BadgeEarned from './BadgeEarned'
import ModeIcon from './ModeIcon'
import ShareLine from './ShareLine'
import SignInToSave from './SignInToSave'
import ReviewStatusMark, { type ReviewSeal } from './ReviewStatus'

// A summary is one frame in a fixed order: what you scored (with the seal beside
// it), what it changed (a short ledger), the mode's signature panel read back in
// a sentence, and what to do next. A fresh run can only be `awaiting` or `not
// recorded` — a referee reads evidence and takes minutes, so a cleared seal is
// never drawn here; the player meets that verdict later.

// `moments` is still accepted so existing callers compile, but the summary no
// longer renders a row of generic tiles — the "what changed" ledger replaced it.
export interface SummaryMoment {
  label: string
  value: string
  tone?: 'gold' | 'purple' | 'green'
}

interface Props {
  eyebrow: string
  headline: string
  pbCallout?: string
  insights: Insights
  moments?: SummaryMoment[]
  share: { mode: GameMode; score: string; series?: number[] }
  // The mode's signature panel — a chart or read-back drawn from data the mode
  // already records. Falls back to the "Work on these" list below.
  children?: ComponentChildren
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

export default function Summary({
  eyebrow,
  headline,
  pbCallout,
  insights,
  share,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome,
  homeLabel = 'Home'
}: Props) {
  const { bands, weakest, slowestCards, hasTiming } = insights
  const offline = offlineRunMode.value === share.mode
  const held = heldForReview.value
  const visiblePbCallout = offline ? undefined : pbCallout
  const shareArena = player.value ? rankFor(player.value.xp ?? 0).current : undefined

  // The seal beside the score is only ever a state a fresh run can be in.
  const seal: ReviewSeal | null = offline ? 'not-recorded' : held ? 'pending' : null
  const stateLine = offline
    ? 'The run happened and your device remembers it. The board never saw it, so nothing moved.'
    : held
      ? 'Awaiting the referee — your score is recorded and ranks while it is checked.'
      : null

  // "Missed this round" and "Slowest reads" are one taxonomy of the same thing:
  // what to practise. Merge them into one list.
  const workOnThese: Card[] = [...weakest]
  if (hasTiming && slowestCards) {
    for (const card of slowestCards) if (!workOnThese.some((w) => w.id === card.id)) workOnThese.push(card)
  }

  const xpEarned = offline ? 0 : earnedXp.value
  const changed = Boolean(visiblePbCallout) || xpEarned > 0 || earnedBadges.value.length > 0

  return (
    <div class="ed-sum" data-summary>
      {/* 1 — What you scored */}
      <div class="ed-sum__head">
        <div class="ed-eyebrow">
          <ModeIcon mode={share.mode} size={44} className="ed-sum__art" />
          {eyebrow}
        </div>
        <div class="ed-sum__score-row">
          <div class="ed-sum__headline">{headline}</div>
          {seal && <ReviewStatusMark status={seal} size={32} struck />}
        </div>
        {stateLine && (
          <p class="ed-sum__state" role="status">
            {stateLine}
            {held && heldForReviewReference.value && (
              <small class="ed-sum__review-reference"> Reference: {heldForReviewReference.value}</small>
            )}
          </p>
        )}
      </div>

      {/* 2 — What it changed: personal best and any rung cleared, one ledger. */}
      {changed && (
        <div class="ed-sum__changed">
          {visiblePbCallout && (
            <div class="ed-sum__changed-row">
              <Icon name="star" /> {visiblePbCallout}
            </div>
          )}
          {xpEarned > 0 && (
            <div class="ed-sum__changed-row">
              <Icon name="zap" /> XP earned <strong class="ed-sum__changed-xp">+{xpEarned}</strong>
            </div>
          )}
          {earnedBadges.value.length > 0 && <BadgeEarned earned={earnedBadges.value} />}
        </div>
      )}

      {/* 3 — The mode's signature panel, then what to practise. */}
      {children && <div class="ed-sum__signature">{children}</div>}
      {workOnThese.length > 0 && (
        <div class="ed-sum-section">
          <div class="ed-sum__label">Work on these</div>
          <div class="ed-sum-chips">
            {workOnThese.slice(0, 6).map((c) => (
              <CardChip card={c} key={c.id} />
            ))}
          </div>
        </div>
      )}

      {/* 4 — What to do next: share, then the actions. */}
      {share.mode !== 'practice' && (
        <ShareLine
          mode={share.mode}
          score={share.score}
          card={{
            bands: bands.filter((band) => band.total > 0),
            ...(share.series && share.series.length ? { series: share.series } : {}),
            ...(player.value?.publicName ? { playerName: player.value.publicName } : {}),
            ...(shareArena ? { arenaName: shareArena.name } : {})
          }}
        />
      )}

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
