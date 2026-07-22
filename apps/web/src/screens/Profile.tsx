import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import rawCards from '@elixir-drop/game-data/cards.json'
import PlayerAvatar from '../components/PlayerAvatar'
import ArenaProgress from '../components/ArenaProgress'
import Icon from '../components/Icon'
import { rankFor } from '../data/starRanks'
import {
  accountStatus,
  deleteAccount,
  player,
  recentRuns,
  refreshAccount,
  sessionToken,
  signOut,
  updateAccount
} from '../lib/account'
import { getNameOptions } from '../lib/api'
import { challengeCard } from '../lib/challenge-cards'
import { gameDisplay, scoreLabel } from '../lib/game-metadata'
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
  const deletionOpen = useSignal(false)
  const deletionConfirmation = useSignal('')
  const deletingAccount = useSignal(false)
  const deletionError = useSignal('')
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
      <div class="ed-profile-guest">
        <span class="ed-profile-guest__halo" aria-hidden="true">
          <span class="ed-drop-shape ed-profile-guest__drop" />
        </span>
        <div>
          <h1 class="ed-h1">Player profile</h1>
          <p class="ed-profile-guest__lede">
            Sign in to save your games, earn levels, and climb the seasonal leaderboards.
          </p>
        </div>
        <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => navigate('/login')}>
          <span class="tap-face">Send magic link</span>
        </button>
        <div class="ed-profile-guest__note">No password — we email you a one-tap link.</div>
        <button class="ed-textlink" onClick={() => navigate('/')}>
          Keep playing as guest
        </button>
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

  async function removeAccount(event: Event) {
    event.preventDefault()
    if (deletionConfirmation.value !== 'DELETE') return
    deletingAccount.value = true
    deletionError.value = ''
    try {
      await deleteAccount(deletionConfirmation.value)
      navigate('/')
    } catch (error) {
      deletionError.value = error instanceof Error ? error.message : 'Your account could not be deleted.'
      deletingAccount.value = false
    }
  }

  const arena = rankFor(current.xp ?? 0).current

  // ── Edit mode: identity (card + name) + player tag + delete ──────────────
  if (editingIdentity.value) {
    return (
      <div class="ed-edit">
        <header class="ed-edit__top">
          {current.favoriteCardId !== undefined && (
            <button
              class="ed-iconbtn"
              aria-label="Back to profile"
              onClick={() => {
                editingIdentity.value = false
                message.value = ''
              }}
            >
              <Icon name="chevron-left" />
            </button>
          )}
          <div>
            <div class="ed-eyebrow">Your Drop player</div>
            <h1 class="ed-h1">{current.favoriteCardId === undefined ? 'Finish setup' : 'Edit profile'}</h1>
          </div>
        </header>

        <div class="ed-edit__preview">
          <PlayerAvatar favoriteCardId={selectedCard?.id ?? current.favoriteCardId} size="large" />
          <div>
            <div class="ed-edit__preview-name">{current.publicName || 'Choose a name'}</div>
            <div class="ed-edit__preview-card">{(selectedCard ?? currentCard)?.name ?? 'No card'} · Player Card</div>
          </div>
        </div>

        {returnTo && <p class="ed-edit__note">Choose a favorite card and generated name to continue to your game.</p>}

        <section class="ed-edit__section">
          <div class="ed-edit__section-title">Player name</div>
          <p class="ed-edit__section-sub">Inspired by your Player Card. Generate a set and pick your favorite.</p>
          <button
            class="ed-btn ed-btn--gold ed-btn--sm tap-fx"
            onClick={() => void loadNames()}
            disabled={busy.value || !selectedCard}
          >
            <span class="tap-face">
              <Icon name="sparkles" /> {names.value.length ? 'More name ideas' : 'Get name ideas'}
            </span>
          </button>
          {names.value.length > 0 && (
            <div class="ed-edit__names name-options" aria-label="Choose your public player name">
              {names.value.map((name) => (
                <button
                  key={name}
                  class="ed-nameopt name-option"
                  onClick={() => void chooseName(name)}
                  disabled={busy.value}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section class="ed-edit__section">
          <div class="ed-edit__section-title">Player Card</div>
          <input
            type="search"
            class="ed-edit__search"
            placeholder="Search cards"
            value={search.value}
            onInput={(event) => (search.value = event.currentTarget.value)}
          />
          <div class="ed-edit__cards favorite-card-grid" aria-label="Choose your favorite card">
            {visibleCards.slice(0, 60).map((card) => (
              <button
                key={card.id}
                class={`ed-cardopt favorite-card${selectedCardId.value === card.id ? ' ed-cardopt--sel favorite-card--selected' : ''}`}
                aria-label={card.name}
                aria-pressed={selectedCardId.value === card.id}
                onClick={() => selectCard(card.id)}
                disabled={busy.value}
              >
                <PlayerAvatar favoriteCardId={card.id} size="medium" class="ed-cardopt__avatar" />
                <span>{card.name}</span>
              </button>
            ))}
            {!visibleCards.length && <p class="favorite-card-empty ed-edit__noresult">No cards match that search.</p>}
          </div>
        </section>

        <section class="ed-edit__section">
          <div class="ed-edit__section-title">Clash Royale player tag</div>
          <p class="ed-edit__section-sub">Points at a public CR profile (not ownership). Drop loads it when saved.</p>
          <form class="ed-edit__tagform" onSubmit={saveTag}>
            <input
              value={tag.value}
              placeholder="#PLAYER_TAG"
              onInput={(event) => (tag.value = event.currentTarget.value)}
            />
            <button class="ed-btn ed-btn--gold ed-btn--sm tap-fx" disabled={busy.value}>
              <span class="tap-face">Save tag</span>
            </button>
          </form>
        </section>

        {message.value && (
          <div class="ed-edit__msg" role="status">
            {message.value}
          </div>
        )}

        {current.favoriteCardId !== undefined && (
          <div class="ed-edit__actions">
            <button
              class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
              onClick={() => {
                editingIdentity.value = false
                message.value = ''
              }}
              disabled={busy.value}
            >
              <span class="tap-face">Done</span>
            </button>
          </div>
        )}

        <section class="ed-danger">
          <div class="ed-danger__title">Delete account</div>
          <p class="ed-danger__sub">
            Removes your email, Drop identity, saved player tag, game history, and leaderboard entries. This can&rsquo;t
            be undone.
          </p>
          {!deletionOpen.value ? (
            <button
              class="ed-danger__open"
              onClick={() => {
                deletionOpen.value = true
                deletionError.value = ''
              }}
            >
              Delete account
            </button>
          ) : (
            <form class="ed-danger__confirm" onSubmit={removeAccount}>
              <label for="delete-confirmation">Type DELETE to confirm</label>
              <input
                id="delete-confirmation"
                autocomplete="off"
                spellcheck={false}
                value={deletionConfirmation.value}
                onInput={(event) => (deletionConfirmation.value = event.currentTarget.value)}
              />
              {deletionError.value && (
                <div class="ed-edit__msg ed-edit__msg--err" role="alert">
                  {deletionError.value}
                </div>
              )}
              <div class="ed-danger__actions">
                <button
                  type="button"
                  class="ed-btn ed-btn--ghost"
                  disabled={deletingAccount.value}
                  onClick={() => {
                    deletionOpen.value = false
                    deletionConfirmation.value = ''
                    deletionError.value = ''
                  }}
                >
                  <span class="tap-face">Keep my account</span>
                </button>
                <button
                  class="ed-danger__delete"
                  disabled={deletionConfirmation.value !== 'DELETE' || deletingAccount.value}
                >
                  {deletingAccount.value ? 'Deleting…' : 'Permanently delete account'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    )
  }

  // ── Profile view ────────────────────────────────────────────────────────
  return (
    <div class="ed-profile">
      <div class="ed-profile__banner">
        <div class="ed-profile__banner-bg" style={{ backgroundImage: `url('${arena.image}')` }} aria-hidden="true" />
        <div class="ed-profile__banner-row">
          <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
          <div class="ed-profile__ident">
            <div class="ed-profile__name">{current.publicName || 'Choose a favorite card'}</div>
            <div class="ed-profile__card">
              {currentCard ? `${currentCard.name} · Player Card` : 'Pick a Player Card'}
            </div>
            <div class="ed-profile__email">{current.email}</div>
          </div>
          <button class="ed-profile__edit tap-fx" onClick={beginIdentityEdit}>
            <span class="tap-face">
              <Icon name="pencil" /> Edit
            </span>
          </button>
        </div>
      </div>

      <div class="ed-profile__stats profile-xp">
        <div class="ed-profile__stat-row">
          <div class="ed-profile__stat">
            <div class="ed-profile__stat-val ed-profile__stat-val--gold">{(current.xp ?? 0).toLocaleString()}</div>
            <div class="ed-profile__stat-label">Player XP</div>
          </div>
          <div class="ed-profile__stat">
            <div class="ed-profile__stat-val">{current.totalGames.toLocaleString()}</div>
            <div class="ed-profile__stat-label">lifetime games</div>
          </div>
        </div>
        <ArenaProgress xp={current.xp ?? 0} />
      </div>

      <section class="ed-profile__recent">
        <div class="ed-profile__recent-head">
          <span class="ed-profile__recent-title">Recent games</span>
          <button class="ed-textlink" onClick={() => navigate('/leaderboards')}>
            Leaderboards →
          </button>
        </div>
        {recentRuns.value.length ? (
          <ul class="ed-profile__recent-list">
            {recentRuns.value.slice(0, 5).map((run) => {
              const game = gameDisplay(run.mode)
              return (
                <li key={run.runId}>
                  <span class="ed-profile__recent-name">
                    <span aria-hidden="true">{game.icon}</span> {game.name}
                  </span>
                  <span class="ed-profile__recent-score">{scoreLabel(run.mode, run.score)}</span>
                  <time dateTime={run.completedAt}>
                    {new Date(run.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </time>
                </li>
              )
            })}
          </ul>
        ) : (
          <p class="ed-profile__recent-empty">Finish a game and your recent scores will appear here.</p>
        )}
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
                  <small>Not used in Drop — your games deal the full catalog</small>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {message.value && (
        <div class="ed-edit__msg" role="status">
          {message.value}
        </div>
      )}

      <div class="ed-profile__actions">
        <button class="ed-btn ed-btn--ghost tap-fx" onClick={() => navigate('/')}>
          <span class="tap-face">Back to Games</span>
        </button>
        <button
          class="ed-profile__signout tap-fx"
          onClick={() => {
            signOut()
            navigate('/')
          }}
        >
          <span class="tap-face">Sign out</span>
        </button>
      </div>
    </div>
  )
}
