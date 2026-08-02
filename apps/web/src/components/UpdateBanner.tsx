import { reloadToLatest, updateAvailable } from '../lib/version'
import Icon from './Icon'

// Shown when the server reports a newer front-end build than the one running.
export default function UpdateBanner() {
  if (!updateAvailable.value) return null
  return (
    <aside class="update-banner" role="status" aria-live="polite">
      <Icon name="sparkles" className="update-banner__icon" />
      <div class="update-banner__copy">
        <strong>A new version of Elixir Drop is ready.</strong>
        <span>Reload to get the latest games and fixes.</span>
      </div>
      <button class="btn btn--gold btn--sm" onClick={reloadToLatest}>
        Reload
      </button>
    </aside>
  )
}
