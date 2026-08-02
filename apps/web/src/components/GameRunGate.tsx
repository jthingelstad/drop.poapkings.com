import type { Signal } from '@preact/signals'
import Icon from './Icon'

// The gate every mode renders while it has no playable content: either the
// signed run is still being prepared, or preparing it failed. It takes the game
// session itself rather than three unpacked props, because all six modes were
// unpacking it identically and one of them drifting is a silent bug.
interface GameRunGateProps {
  session: {
    preparing: Signal<boolean>
    error: string
    prepare: () => Promise<void>
  }
}

export default function GameRunGate({ session }: GameRunGateProps) {
  const preparing = session.preparing.value
  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <Icon name="loader-circle" className="route-loading__spinner" />
        <div class="eyebrow">Recorded game</div>
        <h1>{preparing ? 'Preparing your game…' : 'This game could not start'}</h1>
        {preparing ? (
          <p class="lede">Drop is creating a signed run so your result counts.</p>
        ) : (
          <>
            <p class="account-message account-message--error">
              {session.error || 'Player services are temporarily unavailable.'}
            </p>
            <p class="lede">Nothing has been played or lost. Try again when you’re ready.</p>
            <button class="btn btn--gold" onClick={() => void session.prepare()}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  )
}
