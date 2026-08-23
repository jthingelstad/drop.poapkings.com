import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { track } from '../lib/analytics'
import { gameDisplay } from '../lib/game-metadata'
import { publishRunShare, uploadRunShareImage } from '../lib/api'
import { sessionToken } from '../lib/account'
import { renderRunSharePreview } from '../lib/share-card'
import { shareLink, type RunShareOutcome, type ShareableGameMode } from '../lib/share-run'
import Icon from './Icon'

interface Props {
  mode: ShareableGameMode
  score: string
  runId: string
  completedAt: string
  compact?: boolean
}

function buttonLabel(outcome: RunShareOutcome | null, sharing: boolean): string {
  if (sharing) return 'Opening…'
  if (outcome === 'shared') return 'Shared'
  if (outcome === 'copied') return 'Copied'
  return 'Share this run'
}

export default function ShareLine({ mode, score, runId, completedAt, compact = false }: Props) {
  const outcome = useSignal<RunShareOutcome | null>(null)
  const sharing = useSignal(false)
  const resetTimer = useRef<number | undefined>(undefined)
  const game = gameDisplay(mode)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function share() {
    if (sharing.value) return
    sharing.value = true
    outcome.value = null
    try {
      const session = sessionToken()
      if (!session) throw new Error('no session')
      const published = await publishRunShare(runId, completedAt, session)
      const image = await renderRunSharePreview(published.preview)
      if (!image) throw new Error('share preview unavailable')
      await uploadRunShareImage(runId, completedAt, image, session)
      const result = await shareLink(published.url)
      outcome.value = result === 'cancelled' ? null : result
      if (result === 'shared' || result === 'copied') {
        track('game.shared', mode)
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => (outcome.value = null), 1800)
      }
    } catch {
      outcome.value = 'unavailable'
    } finally {
      sharing.value = false
    }
  }

  const button = (
    <button class="ed-btn ed-btn--ghost ed-permalink__btn" disabled={sharing.value} onClick={() => void share()}>
      <Icon name={outcome.value === 'shared' || outcome.value === 'copied' ? 'check' : 'share'} />
      {buttonLabel(outcome.value, sharing.value)}
    </button>
  )
  const status = (
    <span class="ed-permalink__status" aria-live="polite">
      {outcome.value === 'copied' && 'Link copied.'}
      {outcome.value === 'unavailable' && 'Sharing is unavailable right now.'}
      {outcome.value === 'shared' && 'Run shared.'}
    </span>
  )

  if (compact)
    return (
      <div class="ed-permalink ed-permalink--compact">
        {button}
        {status}
      </div>
    )

  return (
    <div class="ed-permalink">
      <div class="ed-permalink__copy-block">
        <div class="ed-sum__label">Share your score</div>
        <div class="ed-permalink__score">
          {game.name} · {score}
        </div>
        {status}
      </div>
      {button}
    </div>
  )
}
