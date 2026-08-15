import { offline } from '../lib/api-availability'
import { navigate } from '../lib/router'
import Icon from './Icon'

// Offline is a state with a good answer, so it says the answer rather than only
// the problem. Ranked play needs a signed challenge and genuinely cannot start;
// Practice needs nothing and is one tap away.
//
// Deliberately separate from ApiStatusBanner: that one fires when the API is
// unreachable and asks the player to retry, which is the right response to a
// service outage and the wrong response to being on a plane.
export default function OfflineNotice() {
  if (!offline.value) return null
  return (
    <aside class="ed-offline" role="status" id="offline-note">
      <Icon name="scan-eye" className="ed-offline__icon" />
      <div class="ed-offline__copy">
        <strong>You&rsquo;re offline</strong>
        <span>Ranked games need a connection. Practice works right now — it just isn&rsquo;t saved.</span>
      </div>
      <button class="ed-btn ed-btn--gold ed-btn--sm tap-fx ed-offline__cta" onClick={() => navigate('/practice')}>
        <span class="tap-face">
          <Icon name="play" /> Practice
        </span>
      </button>
    </aside>
  )
}
