import { useSignal } from '@preact/signals'
import { accountStatus, player, sessionToken, signOut, updateAccount } from '../lib/account'
import { getNameOptions } from '../lib/api'
import { navigate } from '../lib/router'

export default function Profile() {
  const tag = useSignal(player.value?.playerTag || '')
  const names = useSignal<string[]>([])
  const nameToken = useSignal('')
  const busy = useSignal(false)
  const message = useSignal('')

  if (accountStatus.value !== 'authenticated' || !player.value) {
    return (
      <div class="main-content account-screen">
        <div class="account-card">
          <h1>Player profile</h1>
          <p class="lede">Sign in to save games, earn levels, and join seasonal leaderboards.</p>
          <button class="btn btn--gold" onClick={() => navigate('/login')}>
            Sign in
          </button>
        </div>
      </div>
    )
  }

  const current = player.value
  const levelSpan = current.nextLevelGames - current.levelStartGames
  const levelProgress = levelSpan ? ((current.totalGames - current.levelStartGames) / levelSpan) * 100 : 0

  async function loadNames() {
    const token = sessionToken()
    if (!token) return
    busy.value = true
    message.value = ''
    try {
      const response = await getNameOptions(token)
      names.value = response.names
      nameToken.value = response.nameToken
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Name choices could not be generated.'
    } finally {
      busy.value = false
    }
  }

  async function chooseName(name: string) {
    busy.value = true
    try {
      await updateAccount({ publicName: name, nameToken: nameToken.value })
      names.value = []
      message.value = 'Public player name saved.'
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Player name could not be saved.'
    } finally {
      busy.value = false
    }
  }

  async function saveTag(event: Event) {
    event.preventDefault()
    busy.value = true
    try {
      await updateAccount({ playerTag: tag.value || null })
      message.value = tag.value ? 'Player tag saved. It is not verified yet.' : 'Player tag removed.'
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Player tag could not be saved.'
    } finally {
      busy.value = false
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card account-card--wide">
        <div class="eyebrow">Your Drop player</div>
        <h1>{current.publicName || 'Choose a player name'}</h1>
        <p class="account-email">{current.email}</p>

        <div class="level-card">
          <strong>Level {current.level}</strong>
          <span>{current.totalGames} lifetime games</span>
          <div class="progress-track">
            <div class="progress-track__fill" style={{ width: `${levelProgress}%` }} />
          </div>
          <small>
            {current.nextLevelGames - current.totalGames} games to level {current.level + 1}
          </small>
        </div>

        <section class="profile-section">
          <h2>Public player name</h2>
          <p>Names are generated only from Clash Royale card-title words—no free-form text.</p>
          <button class="btn btn--ghost" onClick={loadNames} disabled={busy.value}>
            {names.value.length ? 'More choices' : 'Generate choices'}
          </button>
          {names.value.length > 0 && (
            <div class="name-options">
              {names.value.map((name) => (
                <button key={name} class="name-option" onClick={() => void chooseName(name)} disabled={busy.value}>
                  {name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section class="profile-section">
          <h2>Clash Royale player tag</h2>
          <p>
            This points at a public CR profile; it does not authenticate ownership. Card loading comes with the bridge.
          </p>
          <form class="account-form account-form--row" onSubmit={saveTag}>
            <input
              value={tag.value}
              placeholder="#PLAYER_TAG"
              onInput={(event) => (tag.value = event.currentTarget.value)}
            />
            <button class="btn btn--gold" disabled={busy.value}>
              Save tag
            </button>
          </form>
        </section>

        {message.value && (
          <div class="account-message" role="status">
            {message.value}
          </div>
        )}
        <div class="account-actions">
          <button class="btn btn--ghost" onClick={() => navigate('/leaderboards')}>
            Leaderboards
          </button>
          <button
            class="btn btn--ghost"
            onClick={() => {
              signOut()
              navigate('/')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
