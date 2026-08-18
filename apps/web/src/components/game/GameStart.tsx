import { useEffect } from 'preact/hooks'
import RunCountdown from '../RunCountdown'
import { preloadCountdownFrames } from '../../lib/preload'
import { offlineRunMode } from '../../lib/use-game-run'

export type GameStartPhase = 'preparing' | 'loading' | 'countdown'

interface GameStartStageProps {
  modeName: string
  phase: GameStartPhase
  count?: number
}

interface GameStartScreenProps extends GameStartStageProps {
  routePending?: boolean
}

const STATUS_COPY: Record<Exclude<GameStartPhase, 'countdown'>, { visible: string; accessible: string }> = {
  preparing: { visible: 'PREPARING', accessible: 'Preparing game' },
  loading: { visible: 'LOADING', accessible: 'Loading cards' }
}

// One fixed focal point for the entire trip into a run. Preparing the signed
// challenge, loading its card art, and counting down all change only this slot's
// content; the mode name, centering, and game shell never jump between screens.
export function GameStartStage({ modeName, phase, count = 3 }: GameStartStageProps) {
  const status = phase === 'countdown' ? null : STATUS_COPY[phase]

  // Warm the charge frames while the run is still preparing/loading, so the
  // countdown numeral never waits on its art.
  useEffect(() => {
    preloadCountdownFrames()
  }, [])

  return (
    <div class="ed-game__count" data-game-start-phase={phase}>
      <div class="ed-game__count-mode">{modeName}</div>
      {offlineRunMode.value && <div class="ed-game__offline ed-game__offline--start">Offline · not saved</div>}
      <div class={`ed-game__count-num${status ? ' ed-game__count-num--status' : ''}`}>
        {status ? (
          <div class="run-count" role="status" aria-label={status.accessible}>
            <span class="run-count__num run-count__num--status" aria-hidden="true">
              {status.visible}
            </span>
          </div>
        ) : (
          <RunCountdown count={count} />
        )}
      </div>
    </div>
  )
}

export default function GameStartScreen({ routePending = false, ...stageProps }: GameStartScreenProps) {
  return (
    <div class="ed-game ed-game--starting" data-game-route-loading={routePending ? 'true' : undefined}>
      <GameStartStage {...stageProps} />
    </div>
  )
}
