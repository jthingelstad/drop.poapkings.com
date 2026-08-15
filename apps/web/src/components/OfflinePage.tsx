import Icon from './Icon'
import { navigate } from '../lib/router'

type OfflinePageKind = 'leaderboards' | 'profile'

const COPY: Record<OfflinePageKind, { heading: string; line: string }> = {
  leaderboards: {
    heading: 'Leaderboards need a connection',
    line: 'Rankings change with every recorded run, so Drop never presents a saved board as current.'
  },
  profile: {
    heading: 'Your player data is safe',
    line: 'Your profile, badges, and saved games live with player services. This device does not keep an offline copy.'
  }
}

export default function OfflinePage({ kind }: { kind: OfflinePageKind }) {
  const copy = COPY[kind]
  const titleId = `${kind}-offline-title`

  return (
    <section class="main-content ed-offline-page" aria-labelledby={titleId}>
      <div class="account-card ed-offline-page__card">
        <span class="ed-offline-page__mark" aria-hidden="true">
          <Icon name="wifi-off" />
        </span>
        <div class="eyebrow">Offline</div>
        <h2 id={titleId} class="ed-offline-page__title">
          {copy.heading}
        </h2>
        <p class="ed-offline-page__line">{copy.line}</p>
        <p class="ed-offline-page__practice">
          <Icon name="target" />
          <span>Every game is ready offline. Runs stay on this screen and record nothing.</span>
        </p>
        <div class="ed-offline-page__actions">
          <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => navigate('/')}>
            <span class="tap-face">Choose a game</span>
          </button>
          <button class="ed-btn ed-btn--ghost" onClick={() => navigate('/practice')}>
            Open Practice
          </button>
        </div>
      </div>
    </section>
  )
}
