import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { track } from '../lib/analytics'
import { gameDisplay } from '../lib/game-metadata'
import { runSharePayload, shareRunCard, type RunShareOutcome, type ShareableGameMode } from '../lib/share-run'
import Icon from './Icon'
import type { ShareCardInput } from '../lib/share-card'

interface Props {
  mode: ShareableGameMode
  score: string
  compact?: boolean
  // Everything the composited share card draws on top of the backdrop. Absent
  // for surfaces that only have a mode and a score, which share as text.
  card?: Omit<ShareCardInput, 'mode' | 'score'>
}

function buttonLabel(outcome: RunShareOutcome | null, sharing: boolean): string {
  if (sharing) return 'Opening…'
  if (outcome === 'shared') return 'Shared'
  if (outcome === 'copied') return 'Copied'
  return 'Share score'
}

export default function ShareLine({ mode, score, compact = false, card }: Props) {
  const outcome = useSignal<RunShareOutcome | null>(null)
  const sharing = useSignal(false)
  const game = gameDisplay(mode)
  // The "Shared / Copied" confirmation reverts on a timer. Hold it so leaving
  // the summary (Play again, Home) tears the timer down instead of leaving it
  // pending against an unmounted component.
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function share() {
    if (sharing.value) return
    sharing.value = true
    outcome.value = null
    const result = await shareRunCard(runSharePayload(mode, score, window.location.href, card?.playerName), {
      mode,
      score,
      ...card
    })
    sharing.value = false
    outcome.value = result === 'cancelled' ? null : result
    if (result === 'shared' || result === 'copied') {
      track('game.shared', mode)
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => (outcome.value = null), 1800)
    }
  }

  const button = (
    <button class="ed-btn ed-btn--ghost shareline__btn" disabled={sharing.value} onClick={() => void share()}>
      <Icon name={outcome.value === 'shared' || outcome.value === 'copied' ? 'check' : 'share'} />
      {buttonLabel(outcome.value, sharing.value)}
    </button>
  )

  if (compact) return <div class="shareline shareline--compact">{button}</div>

  return (
    <div class="shareline">
      <div class="shareline__copy">
        <div class="ed-sum__label">Share your score</div>
        <div class="shareline__score">
          {game.name} · {score}
        </div>
        <div class="shareline__status" aria-live="polite">
          {outcome.value === 'copied' && 'Native sharing is unavailable, so the score was copied.'}
          {outcome.value === 'unavailable' && 'Sharing is unavailable in this browser.'}
          {outcome.value === 'shared' && 'Score shared.'}
        </div>
      </div>
      {button}
    </div>
  )
}
