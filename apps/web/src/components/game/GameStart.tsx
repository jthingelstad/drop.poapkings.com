import { useEffect } from 'preact/hooks'
import RunCountdown from '../RunCountdown'
import ChargeRing from '../ChargeRing'
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

// One fixed focal point for the entire trip into a run. Preparing the signed
// challenge and loading its card art both show the charge ring; the countdown
// numeral lands in the same slot in the same gold, so the arc completes and the
// numeral takes its place without a jump. The mode name and game shell never move.
export function GameStartStage({ modeName, phase, count = 3 }: GameStartStageProps) {
  const counting = phase === 'countdown'

  // Warm the charge frames while the run is still preparing/loading, so the
  // countdown numeral never waits on its art.
  useEffect(() => {
    preloadCountdownFrames()
  }, [])

  return (
    <div class="ed-game__count" data-game-start-phase={phase}>
      <div class="ed-game__count-mode">{modeName}</div>
      {offlineRunMode.value && <div class="ed-game__offline ed-game__offline--start">Offline · not saved</div>}
      <div class={`ed-game__count-num${counting ? '' : ' ed-game__count-num--status'}`}>
        {counting ? <RunCountdown count={count} /> : <ChargeRing />}
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
