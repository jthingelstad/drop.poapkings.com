import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import rawCards from '@elixir-drop/game-data/cards.json'
import PlayerAvatar from '../components/PlayerAvatar'
import { accountStatus, player, sessionToken, signOut, updateAccount } from '../lib/account'
import { getNameOptions } from '../lib/api'
import { challengeCard } from '../lib/challenge-cards'
import { navigate } from '../lib/router'
import type { CardsData } from '../types'

const favoriteCards = [...(rawCards as CardsData).cards].sort((left, right) => left.name.localeCompare(right.name))

export default function Profile() {
  const tag = useSignal(player.value?.playerTag || '')
  const search = useSignal('')
  const selectedCardId = useSignal<number | null>(player.value?.favoriteCardId ?? null)
  const editingIdentity = useSignal(!player.value?.favoriteCardId)
  const names = useSignal<string[]>([])
  const nameToken = useSignal('')
  const busy = useSignal(false)
  const message = useSignal('')
  const syncedPlayerId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const authenticatedPlayer = player.value
    if (!authenticatedPlayer || syncedPlayerId.current === authenticatedPlayer.id) return
    syncedPlayerId.current = authenticatedPlayer.id
    tag.value = authenticatedPlayer.playerTag || ''
    selectedCardId.value = authenticatedPlayer.favoriteCardId ?? null
    editingIdentity.value = authenticatedPlayer.favoriteCardId === undefined
  })

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
  const currentCard = current.favoriteCardId === undefined ? undefined : challengeCard(current.favoriteCardId)
  const selectedCard = selectedCardId.value === null ? undefined : challengeCard(selectedCardId.value)
  const query = search.value.trim().toLocaleLowerCase()
  const visibleCards = query
    ? favoriteCards.filter((card) => card.name.toLocaleLowerCase().includes(query))
    : favoriteCards
  const levelSpan = current.nextLevelGames - current.levelStartGames
  const levelProgress = levelSpan ? ((current.totalGames - current.levelStartGames) / levelSpan) * 100 : 0

  function beginIdentityEdit() {
    selectedCardId.value = current.favoriteCardId ?? null
    names.value = []
    nameToken.value = ''
    search.value = ''
    message.value = ''
    editingIdentity.value = true
  }

  function selectCard(cardId: number) {
    selectedCardId.value = cardId
    names.value = []
    nameToken.value = ''
    message.value = ''
  }

  async function loadNames() {
    const token = sessionToken()
    if (!token || !selectedCard) return
    busy.value = true
    message.value = ''
    try {
      const response = await getNameOptions(token, selectedCard.id)
      names.value = response.names
      nameToken.value = response.nameToken
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Name choices could not be generated.'
    } finally {
      busy.value = false
    }
  }

  async function chooseName(name: string) {
    if (!selectedCard) return
    busy.value = true
    message.value = ''
    try {
      await updateAccount({
        favoriteCardId: selectedCard.id,
        publicName: name,
        nameToken: nameToken.value
      })
      names.value = []
      editingIdentity.value = false
      message.value = `${selectedCard.name} is now your favorite card.`
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Your player identity could not be saved.'
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
        <div class="profile-identity">
          <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
          <div>
            <h1>{current.publicName || 'Choose a favorite card'}</h1>
            <p class="profile-favorite">
              {currentCard ? `${currentCard.name} · Favorite card` : 'Your favorite card becomes your profile image.'}
            </p>
            <p class="account-email">{current.email}</p>
          </div>
        </div>

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

        <section class="profile-section profile-section--identity">
          <div class="profile-section__head">
            <div>
              <h2>Favorite card and player name</h2>
              <p>Your favorite card is your profile image. Your public name is generated from that card.</p>
            </div>
            {!editingIdentity.value && (
              <button class="btn btn--ghost" onClick={beginIdentityEdit}>
                Change card and name
              </button>
            )}
          </div>

          {editingIdentity.value && (
            <div class="identity-editor">
              <label class="card-search">
                <span>Find a card</span>
                <input
                  type="search"
                  value={search.value}
                  placeholder="Search all cards"
                  onInput={(event) => (search.value = event.currentTarget.value)}
                />
              </label>

              <div class="favorite-card-grid" aria-label="Choose your favorite card">
                {visibleCards.map((card) => (
                  <button
                    key={card.id}
                    class={`favorite-card${selectedCardId.value === card.id ? ' favorite-card--selected' : ''}`}
                    aria-pressed={selectedCardId.value === card.id}
                    onClick={() => selectCard(card.id)}
                    disabled={busy.value}
                  >
                    <PlayerAvatar favoriteCardId={card.id} size="medium" class="favorite-card__avatar" />
                    <span>{card.name}</span>
                  </button>
                ))}
                {!visibleCards.length && <p class="favorite-card-empty">No cards match that search.</p>}
              </div>

              {selectedCard && (
                <div class="selected-card-panel">
                  <PlayerAvatar favoriteCardId={selectedCard.id} size="large" />
                  <div class="selected-card-panel__body">
                    <div class="eyebrow">Selected favorite</div>
                    <h3>{selectedCard.name}</h3>
                    <p>Choose a generated name to save this card and identity together.</p>
                    <button class="btn btn--gold" onClick={() => void loadNames()} disabled={busy.value}>
                      {names.value.length ? 'More name choices' : 'Get name choices'}
                    </button>
                  </div>
                </div>
              )}

              {names.value.length > 0 && (
                <div class="name-options" aria-label="Choose your public player name">
                  {names.value.map((name) => (
                    <button key={name} class="name-option" onClick={() => void chooseName(name)} disabled={busy.value}>
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {current.favoriteCardId !== undefined && (
                <button
                  class="identity-cancel"
                  onClick={() => {
                    editingIdentity.value = false
                    message.value = ''
                  }}
                  disabled={busy.value}
                >
                  Cancel
                </button>
              )}
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
