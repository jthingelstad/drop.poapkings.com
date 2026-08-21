import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { GameMode } from '@elixir-drop/contracts'
import type { Insights } from '../lib/insights'
import { earnedBadges, earnedXp, earnedXpAwards, offlineRunMode, recordedRunId } from '../lib/use-game-run'
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
import { useGameKeys } from '../lib/use-game-keys'
import { isInteractiveKeyTarget, isSpaceKey } from '../lib/game-keys'

// A summary is one frame in a fixed order: what you scored, what it changed (a
// short ledger), the mode's signature panel read back in a sentence, and what to
// do next.
//
// The summary's job is what happened, not what is pending. There is no
// "Awaiting a referee" line and no awaiting seal here: at the moment a run ends
// EVERY recorded run is awaiting, so a mark every run carries tells a player
// nothing. That state is keyed where it can differ — on the boards, in the run
// log, in the Updates slot. A cleared seal is never drawn on a summary either: a
// referee reads input evidence and takes minutes, so it cannot have cleared a
// run that ended two seconds ago.
//
// The one seal that survives is `not recorded`, because that IS what happened:
// an offline or guest run the board never saw.

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
  share: { mode: GameMode; score: string; series?: number[]; refs?: number[]; bad?: boolean[] }
  // The mode's signature panel — a chart or read-back drawn from data the mode
  // already records. Falls back to the "Work on these" list below.
  children?: ComponentChildren
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

export default function Summary({
  eyebrow,
  headline,
  pbCallout,
  insights,
  share,
  children,
  onReplay,
  replayLabel = 'Play again',
  onHome
}: Props) {
  const headingRef = useRef<HTMLDivElement>(null)
  const { bands, weakest, slowestCards, hasTiming } = insights
  const offline = offlineRunMode.value === share.mode
  const visiblePbCallout = offline ? undefined : pbCallout
  const shareArena = player.value ? rankFor(player.value.xp ?? 0).current : undefined

  // The only seal a summary draws: this run was not recorded at all.
  const seal: ReviewSeal | null = offline ? 'not-recorded' : null
  const stateLine = offline
    ? 'The run happened and your device remembers it. The board never saw it, so nothing moved.'
    : null

  // "Missed this round" and "Slowest reads" are one taxonomy of the same thing:
  // what to practise. Merge them into one list.
  const workOnThese: Card[] = [...weakest]
  if (hasTiming && slowestCards) {
    for (const card of slowestCards) if (!workOnThese.some((w) => w.id === card.id)) workOnThese.push(card)
  }

  const xpEarned = offline ? 0 : earnedXp.value
  const changed = Boolean(visiblePbCallout) || xpEarned > 0 || earnedBadges.value.length > 0

  // Results own the desktop default action. Focus follows the state change so
  // Space can immediately deal the next run without reaching for a pointer.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  useGameKeys((event) => {
    if (!isSpaceKey(event) || isInteractiveKeyTarget(event.target)) return
    event.preventDefault()
    onReplay()
  })

  return (
    <div class="ed-sum" data-summary>
      {/* 1 — What you scored */}
      <div class="ed-sum__head" ref={headingRef} tabIndex={-1}>
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
            <>
              <div class="ed-sum__changed-row">
                <Icon name="zap" /> XP earned <strong class="ed-sum__changed-xp">+{xpEarned}</strong>
              </div>
              {earnedXpAwards.value.map((award, index) => (
                <div
                  class="ed-sum__changed-row ed-sum__changed-row--detail"
                  key={`${award.source}-${award.label}-${index}`}
                >
                  <span>{award.label}</span>
                  <strong>+{award.amount}</strong>
                </div>
              ))}
            </>
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

      {/* 4 — What to do next: share, then the actions.
          A not-recorded run has NO share control: offline and guest runs have no
          server record, so no permalink can exist. Absent, not disabled. */}
      {share.mode !== 'practice' && recordedRunId.value && (
        <ShareLine
          mode={share.mode}
          score={share.score}
          runId={recordedRunId.value}
          card={{
            bands: bands.filter((band) => band.total > 0),
            ...(share.series && share.series.length ? { series: share.series } : {}),
            // A share card drops the game's half of the chart. Only a reference
            // the PLAYER owns travels, so a mode passes `refs` when and only
            // when it is their own previous best.
            ...(share.refs && share.refs.length ? { refs: share.refs } : {}),
            ...(share.bad && share.bad.length ? { bad: share.bad } : {}),
            ...(player.value?.publicName ? { playerName: player.value.publicName } : {}),
            ...(shareArena ? { arenaName: shareArena.name } : {})
          }}
        />
      )}

      {!offline && share.mode !== 'practice' && <SignInToSave />}

      <div class="ed-sum__actions">
        <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={onReplay} aria-keyshortcuts="Space">
          <span class="tap-face">
            {replayLabel}
            <kbd class="ed-default-key" aria-hidden="true">
              SPACE
            </kbd>
          </span>
        </button>
        <button class="ed-btn ed-btn--ghost tap-fx" onClick={onHome}>
          <span class="tap-face">Home</span>
        </button>
      </div>
    </div>
  )
}
