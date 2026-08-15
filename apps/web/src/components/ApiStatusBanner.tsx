import { useSignal } from '@preact/signals'
import { accountStatus, initializeAccount } from '../lib/account'
import { getStats } from '../lib/api'
import { apiAvailability, apiUnavailableReason, offline } from '../lib/api-availability'
import Icon from './Icon'

export default function ApiStatusBanner() {
  const reconnecting = useSignal(false)

  // Being offline has its own notice with a usable next step, so this one
  // stays out of the way rather than stacking a second banner that only offers
  // a retry the network cannot satisfy.
  if (apiAvailability.value !== 'unavailable' || offline.value) return null

  const offlineReason = apiUnavailableReason.value === 'offline'
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
      <Icon name="clock" className="api-status__icon" />
      <div class="api-status__copy">
        <h2>{offlineReason ? 'Drop can’t reach the internet' : 'Drop is taking a quick elixir break'}</h2>
        <p>
          {offlineReason
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
