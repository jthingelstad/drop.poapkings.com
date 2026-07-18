import { useSignal } from '@preact/signals'
import { accountStatus, initializeAccount } from '../lib/account'
import { getStats } from '../lib/api'
import { apiAvailability, apiUnavailableReason } from '../lib/api-availability'

export default function ApiStatusBanner() {
  const reconnecting = useSignal(false)

  if (apiAvailability.value !== 'unavailable') return null

  const offline = apiUnavailableReason.value === 'offline'
  const reconnect = async () => {
    if (reconnecting.value) return
    reconnecting.value = true
    try {
      await getStats()
      if (accountStatus.value === 'unavailable') await initializeAccount()
    } catch {
      // The shared API state keeps this notice visible with the right reason.
    } finally {
      reconnecting.value = false
    }
  }

  return (
    <aside class="api-status" role="alert" aria-live="polite">
      <img src="/assets/emoji/elixir_time.png" alt="" class="api-status__icon" aria-hidden="true" />
      <div class="api-status__copy">
        <h2>{offline ? 'Drop can’t reach the internet' : 'Drop is taking a quick elixir break'}</h2>
        <p>
          {offline
            ? 'Check your connection. Your account and recorded games are safe.'
            : 'Player services are unavailable right now. Your account and recorded games are safe.'}
        </p>
      </div>
      <button class="btn btn--ghost btn--sm api-status__retry" disabled={reconnecting.value} onClick={reconnect}>
        {reconnecting.value ? 'Checking…' : 'Try reconnecting'}
      </button>
    </aside>
  )
}
