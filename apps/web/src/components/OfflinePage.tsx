import Icon from './Icon'
import { offline } from '../lib/api-availability'
import { navigate } from '../lib/router'

export default function OfflinePage() {
  const disconnected = offline.value

  return (
    <section class="main-content ed-offline-page" aria-labelledby="offline-title">
      <div class="account-card ed-offline-page__card">
        <span class="ed-offline-page__mark" aria-hidden="true">
          <Icon name="wifi-off" />
        </span>
        <div class="eyebrow">Offline</div>
        <h2 id="offline-title" class="ed-offline-page__title">
          {disconnected ? 'Offline mode is ready' : 'You’re back online'}
        </h2>
        <p class="ed-offline-page__line">
          {disconnected
            ? 'All six games are available from this device. Ranks and You return to navigation when you reconnect.'
            : 'Ranks, your profile, and saved progress are available again.'}
        </p>
        <p class="ed-offline-page__practice">
          <Icon name={disconnected ? 'wifi-off' : 'check'} />
          <span>
            {disconnected
              ? 'Offline runs are not saved and do not change personal bests, badges, XP, history, or leaderboard position.'
              : 'Online runs can be recorded and advance your player progress.'}
          </span>
        </p>
        <div class="ed-offline-page__actions">
          {disconnected ? (
            <>
              <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => navigate('/')}>
                <span class="tap-face">Choose a game</span>
              </button>
              <button class="ed-btn ed-btn--ghost" onClick={() => navigate('/practice')}>
                Open Practice
              </button>
            </>
          ) : (
            <>
              <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => navigate('/leaderboards')}>
                <span class="tap-face">View Ranks</span>
              </button>
              <button class="ed-btn ed-btn--ghost" onClick={() => navigate('/profile')}>
                Open You
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
