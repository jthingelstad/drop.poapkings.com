import { track } from '../lib/analytics'
import { gameDisplay } from '../lib/game-metadata'
import { publishRunShare, uploadRunShareImage } from '../lib/api'
import { sessionToken } from '../lib/account'
import { renderRunSharePreview } from '../lib/share-card'
import type { ShareableGameMode } from '../lib/share-run'
import ShareAction from './ShareAction'

interface Props {
  mode: ShareableGameMode
  score: string
  runId: string
  completedAt: string
  compact?: boolean
}

export default function ShareLine({ mode, score, runId, completedAt, compact = false }: Props) {
  const game = gameDisplay(mode)

  async function prepare() {
    const session = sessionToken()
    if (!session) throw new Error('no session')
    const published = await publishRunShare(runId, completedAt, session)
    const image = await renderRunSharePreview(published.preview)
    if (!image) throw new Error('share preview unavailable')
    await uploadRunShareImage(runId, completedAt, image, session)
    return published.url
  }

  const action = (
    <ShareAction
      prepare={prepare}
      className="ed-permalink__action"
      buttonClassName="ed-btn ed-btn--ghost ed-permalink__btn"
      statusClassName="ed-permalink__status"
      onComplete={() => track('game.shared', mode)}
    />
  )

  if (compact) return <div class="ed-permalink ed-permalink--compact">{action}</div>

  return (
    <div class="ed-permalink">
      <div class="ed-permalink__copy-block">
        <div class="ed-sum__label">Share your score</div>
        <div class="ed-permalink__score">
          {game.name} · {score}
        </div>
      </div>
      {action}
    </div>
  )
}
