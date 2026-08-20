import type { Signal } from '@preact/signals'
import GameStartScreen from './game/GameStart'
import { useGameKeys } from '../lib/use-game-keys'
import { isInteractiveKeyTarget, isSpaceKey } from '../lib/game-keys'

// The gate every mode renders while it has no playable content: either the
// signed run is still being prepared, or preparing it failed. It takes the game
// session itself rather than three unpacked props, because all six modes were
// unpacking it identically and one of them drifting is a silent bug.
interface GameRunGateProps {
  modeName: string
  session: {
    preparing: Signal<boolean>
    error: string
    prepare: () => Promise<void>
  }
}

export default function GameRunGate({ modeName, session }: GameRunGateProps) {
  const preparing = session.preparing.value
  useGameKeys((event) => {
    if (preparing || !isSpaceKey(event) || isInteractiveKeyTarget(event.target)) return
    event.preventDefault()
    void session.prepare()
  })
  if (preparing) return <GameStartScreen modeName={modeName} phase="preparing" />

  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <div class="eyebrow">Game setup</div>
        <h1>This game could not start</h1>
        <p class="account-message account-message--error">
          {session.error || 'Player services are temporarily unavailable.'}
        </p>
        <p class="lede">Nothing has been played or lost. Try again when you’re ready.</p>
        <button class="btn btn--gold" onClick={() => void session.prepare()} aria-keyshortcuts="Space">
          Try again{' '}
          <kbd class="ed-default-key" aria-hidden="true">
            SPACE
          </kbd>
        </button>
      </div>
    </div>
  )
}
