import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import rawCards from '@elixir-drop/game-data/cards.json'
import PlayerAvatar from '../components/PlayerAvatar'
import { accountStatus, player, refreshAccount, sessionToken, signOut, updateAccount } from '../lib/account'
import { getNameOptions } from '../lib/api'
import { challengeCard } from '../lib/challenge-cards'
import { gameReturnPathFromRoute } from '../lib/game-routes'
import { navigate, route } from '../lib/router'
import type { CardsData } from '../types'

const favoriteCards = [...(rawCards as CardsData).cards].sort((left, right) => left.name.localeCompare(right.name))

function accountAgeText(years: number | undefined, days: number | undefined): string {
  if (days !== undefined) {
    const fullYears = Math.floor(days / 365)
    const remainingDays = days % 365
    const parts = [
      ...(fullYears ? [`${fullYears} ${fullYears === 1 ? 'year' : 'years'}`] : []),
      ...(remainingDays || !fullYears ? [`${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`] : [])
    ]
    return `${parts.join(', ')} in Clash Royale`
  }
  if (years !== undefined) return years === 1 ? 'About 1 year in Clash Royale' : `About ${years} years in Clash Royale`
  return 'Account age unavailable'
}

function roleText(role: string | undefined): string | undefined {
  if (!role) return undefined
  return role.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

function fetchedText(value: string | undefined): string | undefined {
  if (!value) return undefined
  return `${new Date(value).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })} UTC`
}

const CR_LOADING_MESSAGE = 'Player tag saved. Loading its public Clash Royale profile…'

export default function Profile() {
  const returnTo = gameReturnPathFromRoute(route.value)
  const tag = useSignal(player.value?.playerTag || '')
  const search = useSignal('')
  const selectedCardId = useSignal<number | null>(player.value?.favoriteCardId ?? null)
  const editingIdentity = useSignal(!player.value?.favoriteCardId)
  const names = useSignal<string[]>([])
  const nameToken = useSignal('')
  const busy = useSignal(false)
  const message = useSignal('')
  const syncedPlayerId = useRef<string | undefined>(undefined)
  const pollingCrStatus = player.value?.clashRoyale?.status

  useEffect(() => {
    const authenticatedPlayer = player.value
    if (!authenticatedPlayer || syncedPlayerId.current === authenticatedPlayer.id) return
    syncedPlayerId.current = authenticatedPlayer.id
    tag.value = authenticatedPlayer.playerTag || ''
    selectedCardId.value = authenticatedPlayer.favoriteCardId ?? null
    editingIdentity.value = authenticatedPlayer.favoriteCardId === undefined
  })

  useEffect(() => {
    if (pollingCrStatus !== 'pending') return
    const interval = window.setInterval(() => void refreshAccount().catch(() => undefined), 2_000)
    return () => window.clearInterval(interval)
  }, [pollingCrStatus])

  useEffect(() => {
    if (message.value !== CR_LOADING_MESSAGE || pollingCrStatus === 'pending') return
    if (pollingCrStatus === 'ready') message.value = 'Clash Royale profile loaded.'
    if (pollingCrStatus === 'not_found') message.value = 'Player tag was not found.'
    if (pollingCrStatus === 'unavailable') message.value = 'Profile refresh delayed. Drop will retry automatically.'
  }, [message.value, pollingCrStatus])

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
      if (returnTo) {
        navigate(returnTo)
      } else {
        message.value = `${selectedCard.name} is now your favorite card.`
      }
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
      message.value = tag.value ? CR_LOADING_MESSAGE : 'Player tag removed.'
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Player tag could not be saved.'
    } finally {
      busy.value = false
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card account-card--wide">
        <div class="eyebrow">{returnTo && !current.favoriteCardId ? 'Finish player setup' : 'Your Drop player'}</div>
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
              <p>Your favorite card is your profile image. Your public name is playfully inspired by that card.</p>
            </div>
            {!editingIdentity.value && (
              <button class="btn btn--ghost" onClick={beginIdentityEdit}>
                Change card and name
              </button>
            )}
          </div>

          {returnTo && editingIdentity.value && (
            <p class="profile-onboarding-note">Choose a favorite card and generated name to continue to your game.</p>
          )}

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
                    aria-label={card.name}
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
                    <p>Choose a card-inspired name—nicknames and wordplay included.</p>
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
            This points at a public CR profile and does not authenticate ownership. Drop loads it when saved, then
            refreshes it when you sign in.
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

        {current.clashRoyale && (
          <section class="profile-section cr-profile" aria-live="polite">
            {current.clashRoyale.status === 'pending' && (
              <div class="cr-profile__state">
                <div class="cr-profile__pulse" aria-hidden="true" />
                <div>
                  <h2>Loading Clash Royale profile</h2>
                  <p>The fixed-IP helper is fetching {current.clashRoyale.tag}. This page will update automatically.</p>
                </div>
              </div>
            )}

            {current.clashRoyale.status === 'not_found' && (
              <div class="cr-profile__state">
                <div>
                  <h2>Player tag not found</h2>
                  <p>Clash Royale could not find {current.clashRoyale.tag}. Check the tag and save it again.</p>
                </div>
              </div>
            )}

            {current.clashRoyale.status === 'unavailable' && (
              <div class="cr-profile__state">
                <div>
                  <h2>Profile refresh delayed</h2>
                  <p>The saved tag is safe. Save it again or sign in later to retry.</p>
                </div>
              </div>
            )}

            {current.clashRoyale.status === 'ready' && (
              <>
                <div class="cr-profile__head">
                  <div>
                    <div class="eyebrow">Clash Royale profile</div>
                    <h2>{current.clashRoyale.name}</h2>
                    <p class="cr-profile__tag">{current.clashRoyale.tag}</p>
                  </div>
                  {fetchedText(current.clashRoyale.fetchedAt) && (
                    <small>Updated {fetchedText(current.clashRoyale.fetchedAt)}</small>
                  )}
                </div>

                <div class="cr-profile__facts">
                  <div>
                    <span>Clan</span>
                    <strong>{current.clashRoyale.clan?.name || 'No clan'}</strong>
                    {roleText(current.clashRoyale.clan?.role) && (
                      <small>{roleText(current.clashRoyale.clan?.role)}</small>
                    )}
                  </div>
                  <div>
                    <span>Account age</span>
                    <strong>
                      {accountAgeText(current.clashRoyale.accountAge?.years, current.clashRoyale.accountAge?.days)}
                    </strong>
                    <small>
                      {current.clashRoyale.accountAge
                        ? 'Calculated from the Years Played badge’s day count'
                        : 'Years Played badge not returned by Clash Royale'}
                    </small>
                  </div>
                  <div>
                    <span>Collection</span>
                    <strong>{current.clashRoyale.cards?.length || 0} cards</strong>
                    <small>Levels stay private</small>
                  </div>
                </div>

                <div class="cr-collection">
                  <div class="cr-collection__head">
                    <h3>Card collection</h3>
                    <span>{current.clashRoyale.cards?.length || 0} owned</span>
                  </div>
                  <div class="cr-card-grid" aria-label="Clash Royale card collection">
                    {current.clashRoyale.cards?.map((card) => {
                      const catalogCard = challengeCard(card.id)
                      return (
                        <div class="cr-card" key={card.id}>
                          {(card.iconUrl || catalogCard?.icon) && (
                            <img src={card.iconUrl || catalogCard?.icon} alt="" loading="lazy" />
                          )}
                          <span>{card.name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </section>
        )}

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
