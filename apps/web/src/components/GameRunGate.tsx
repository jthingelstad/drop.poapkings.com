interface GameRunGateProps {
  preparing: boolean
  error: string
  onRetry: () => void
}

export default function GameRunGate({ preparing, error, onRetry }: GameRunGateProps) {
  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" aria-hidden="true" />
        <div class="eyebrow">Recorded game</div>
        <h1>{preparing ? 'Preparing your game…' : 'This game could not start'}</h1>
        {preparing ? (
          <p class="lede">Drop is creating a signed run so your result counts.</p>
        ) : (
          <>
            <p class="account-message account-message--error">
              {error || 'Player services are temporarily unavailable.'}
            </p>
            <p class="lede">Nothing has been played or lost. Try again when you’re ready.</p>
            <button class="btn btn--gold" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  )
}
