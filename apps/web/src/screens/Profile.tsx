import { useSignal } from '@preact/signals'
import { BADGE_LIST, playerReference, runReference } from '@elixir-drop/contracts'
import type { GameMode } from '@elixir-drop/contracts'
import { useEffect, useRef } from 'preact/hooks'
import PlayerAvatar from '../components/PlayerAvatar'
import { arenaProgress, ArenaProgressBar } from '../components/ArenaProgress'
import Icon from '../components/Icon'
import ReviewStatusMark, { type ReviewStatus } from '../components/ReviewStatus'
import {
  accountStatus,
  badges,
  deleteAccount,
  player,
  refreshAccount,
  sessionToken,
  signOut,
  updateAccount
} from '../lib/account'
import { getNameOptions } from '../lib/api'
import { getSeasonHistory, type RecentRun, type SeasonIndexEntry } from '../lib/api'
import { allCards } from '../lib/card-catalog'
import { challengeCard } from '../lib/challenge-cards'
import { badgeViews, earnedCount } from '../lib/badges'
import BadgeGrid from '../components/BadgeGrid'
import EmptyState from '../components/EmptyState'
import ModeIcon from '../components/ModeIcon'
import { GAMES, gameDisplay, LOWER_IS_BETTER, scoreLabel } from '../lib/game-metadata'
import { gameReturnPathFromRoute } from '../lib/game-routes'
import { contactEmailHref } from '../lib/links'
import { navigate, route } from '../lib/router'
import { layout } from '../lib/use-layout'
import MetaMoreList from '../components/MetaMoreList'
import PlayerPreferences from '../components/PlayerPreferences'
import DetailModal from '../components/DetailModal'

const favoriteCards = [...allCards].sort((left, right) => left.name.localeCompare(right.name))

// `3y 41d playing` — compact enough to sit on one line with role and tag.
function accountAgeText(years: number | undefined, days: number | undefined): string {
  if (days !== undefined) {
    const fullYears = Math.floor(days / 365)
    const remainder = days % 365
    return fullYears ? `${fullYears}y ${remainder}d playing` : `${remainder}d playing`
  }
  if (years !== undefined) return `${years}y playing`
  return 'Account age unavailable'
}

// "Updated 2h ago" — how stale the CR snapshot is, in the coarsest unit that
// still says something useful.
function freshnessText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Updated ${hours}h ago`
  return `Updated ${Math.round(hours / 24)}d ago`
}

function roleText(role: string | undefined): string | undefined {
  if (!role) return undefined
  return role.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

const CR_LOADING_MESSAGE = 'Player tag saved. Loading its public Clash Royale profile…'

export default function Profile() {
  const profileRoute = route.value
  const returnTo = gameReturnPathFromRoute(profileRoute)
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
  const allBadgesShown = useSignal(false)
  const syncedPlayerId = useRef<string | undefined>(undefined)
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const handledTagEditRequest = useRef(false)
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
    const query = profileRoute.split('?', 2)[1]
    if (handledTagEditRequest.current || new URLSearchParams(query).get('edit') !== 'player-tag') return
    handledTagEditRequest.current = true
    editingIdentity.value = true
    const frame = window.requestAnimationFrame(() => {
      tagInputRef.current?.scrollIntoView({ block: 'center' })
      tagInputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [profileRoute, editingIdentity])

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

        {layout.value === 'mobile' && <MetaMoreList />}
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

  // ── Edit mode: identity (card + name) + player tag ───────────────────────
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
              id="clash-player-tag"
              ref={tagInputRef}
              aria-label="Clash Royale player tag"
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
      </div>
    )
  }

  // Hidden badges are never counted separately — no "3 of 7 found" — but the
  // overall earned tally is fine: it is the whole set, not a hidden checklist.
  const earnedBadges = earnedCount(badgeViews(badges.value))
  const arena = arenaProgress(current.xp ?? 0)
  const clan = current.clashRoyale?.clan

  // ── Profile view ────────────────────────────────────────────────────────
  return (
    <div class="ed-profile">
      <div class="ed-profile__banner">
        <div
          class="ed-profile__banner-bg"
          style={{ backgroundImage: `url('${arena.current.image}')` }}
          aria-hidden="true"
        />
        <div class="ed-profile__banner-row">
          <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
          <div class="ed-profile__ident">
            <div class="ed-profile__name">{current.publicName || 'Choose a favorite card'}</div>
            <div class="ed-profile__card">
              {currentCard ? `${currentCard.name} · Player Card` : 'Pick a Player Card'}
            </div>
          </div>
          <button class="ed-profile__edit tap-fx" onClick={beginIdentityEdit}>
            <span class="tap-face">
              <Icon name="pencil" /> Edit
            </span>
          </button>
        </div>
        {/* The arena line the stats row used to duplicate: name and XP sit on
            the bar itself, and everything else fits on one line under it. */}
        <div class="ed-profile__arena">
          <div class="ed-profile__arena-row">
            <span class="ed-profile__arena-name">{arena.current.name}</span>
            <span class="ed-profile__arena-xp">{(current.xp ?? 0).toLocaleString()} XP</span>
          </div>
          <ArenaProgressBar xp={current.xp ?? 0} />
          <div class="ed-profile__arena-note">
            {arena.toGoLabel} · {current.totalGames.toLocaleString()} lifetime games
          </div>
        </div>
      </div>

      {current.rankedAccess === 'restricted' && (
        <aside class="ed-profile__ranked-restriction" role="status">
          <strong>Ranked access restricted</strong>
          <span>Practice and your account remain available. You may request a re-review.</span>
          <a class="ed-textlink" href="/fair-play/">
            Read Fair Play
          </a>
          <a class="ed-textlink" href={contactEmailHref('Elixir Drop ranked-access re-review')}>
            Request re-review
          </a>
        </aside>
      )}

      <section class="ed-profile__recent ed-profile__badges ed-profile__badges--featured">
        <div class="ed-profile__recent-head">
          <span class="ed-profile__recent-title">Badges</span>
          {/* The count is the affordance: the strip shows a handful, and this
              opens the rest in place rather than on another screen. */}
          <button
            class="ed-profile__badges-toggle"
            aria-expanded={allBadgesShown.value}
            onClick={() => (allBadgesShown.value = !allBadgesShown.value)}
          >
            {earnedBadges} of {BADGE_LIST.length}
            <Icon name={allBadgesShown.value ? 'chevron-up' : 'chevron-right'} />
          </button>
        </div>
        <BadgeGrid
          states={badges.value}
          featured={!allBadgesShown.value}
          playerId={current.id}
          playerName={current.publicName}
        />
      </section>

      <YourGames playerId={current.id} />

      {current.clashRoyale && (
        <section class="ed-profile__recent ed-profile__cr-panel" aria-live="polite">
          <div class="ed-profile__recent-head">
            <span class="ed-profile__recent-title">Clash Royale</span>
            {freshnessText(current.clashRoyale.fetchedAt) && (
              <span class="ed-profile__recent-score ed-profile__cr-fresh">
                {freshnessText(current.clashRoyale.fetchedAt)}
              </span>
            )}
          </div>
          <div class="ed-profile__cr">
            <span class="ed-profile__cr-crest" aria-hidden="true">
              <Icon name="shield" />
            </span>
            {current.clashRoyale.status === 'ready' ? (
              <>
                <span class="ed-profile__cr-ident">
                  <strong>{clan?.name ?? current.clashRoyale.name ?? 'No clan'}</strong>
                  <small>
                    {[
                      roleText(clan?.role),
                      current.clashRoyale.tag,
                      accountAgeText(current.clashRoyale.accountAge?.years, current.clashRoyale.accountAge?.days)
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <button class="ed-textlink" onClick={() => navigate('/leaderboards')}>
                  Clan board <Icon name="chevron-right" />
                </button>
              </>
            ) : (
              <span class="ed-profile__cr-ident">
                <strong>
                  {current.clashRoyale.status === 'pending'
                    ? 'Loading Clash Royale profile'
                    : current.clashRoyale.status === 'not_found'
                      ? 'Player tag not found'
                      : 'Profile refresh delayed'}
                </strong>
                <small>
                  {current.clashRoyale.status === 'pending'
                    ? `Fetching ${current.clashRoyale.tag}. This updates automatically.`
                    : current.clashRoyale.status === 'not_found'
                      ? `Clash Royale could not find ${current.clashRoyale.tag}. Check the tag and save it again.`
                      : 'The saved tag is safe. Drop will retry automatically.'}
                </small>
              </span>
            )}
          </div>
        </section>
      )}

      <section class="ed-profile__preferences" aria-labelledby="game-settings-title">
        <h2 id="game-settings-title" class="ed-profile__recent-title">
          Settings
        </h2>
        <PlayerPreferences />
      </section>

      {message.value && (
        <div class="ed-edit__msg" role="status">
          {message.value}
        </div>
      )}

      {/* Account ends the page. Deleting an account used to hide inside the
          identity editor, which is the last place someone looking for it
          would open. */}
      <section class="ed-profile__account" aria-labelledby="account-title">
        <h2 id="account-title" class="ed-profile__recent-title">
          Account
        </h2>
        <div class="ed-profile__account-line">
          {current.email} · Player <span class="ed-profile__reference">{playerReference(current.id)}</span>
        </div>
        <div class="ed-profile__account-actions">
          <button
            class="ed-profile__signout tap-fx"
            onClick={() => {
              signOut()
              navigate('/')
            }}
          >
            <span class="tap-face">Sign out</span>
          </button>
          {!deletionOpen.value && (
            <button
              class="ed-danger__open"
              onClick={() => {
                deletionOpen.value = true
                deletionError.value = ''
              }}
            >
              Delete account
            </button>
          )}
        </div>

        <div class="ed-danger">
          {deletionOpen.value && (
            <p class="ed-danger__sub">
              Removes your email, Drop identity, saved player tag, game history, and leaderboard entries. This
              can&rsquo;t be undone.
            </p>
          )}
          {!deletionOpen.value ? null : (
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
        </div>
      </section>

      {layout.value === 'mobile' && <MetaMoreList />}
    </div>
  )
}

// ── Your games ────────────────────────────────────────────────────────────

type StatusFilter = 'any' | ReviewStatus

const STATUS_TILES: Array<{ key: ReviewStatus; label: string }> = [
  { key: 'reviewed', label: 'Cleared' },
  { key: 'pending', label: 'Awaiting' },
  { key: 'excluded', label: 'Excluded' }
]

// Players know Clash Royale season numbers, not Drop's internal calendar ids.
// The raw id is the fallback for a season the server could not number.
function seasonLabel(season: SeasonIndexEntry | undefined, id: string): string {
  const crSeasonId = season?.crSeasonId
  return crSeasonId === undefined ? id : `Season ${crSeasonId}`
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long' }).toLocaleUpperCase()
}

function dayLabel(iso: string): string {
  return String(new Date(iso).getDate()).padStart(2, '0')
}

function bestOf(runs: RecentRun[], mode: GameMode): number | undefined {
  const scores = runs.filter((run) => run.mode === mode).map((run) => run.score)
  if (!scores.length) return undefined
  return LOWER_IS_BETTER.has(mode) ? Math.min(...scores) : Math.max(...scores)
}

function YourGames({ playerId }: { playerId: string }) {
  // Season list and loaded runs are separate on purpose: the index is a handful
  // of rows that lets the picker and the paging button exist without pulling a
  // career's worth of games into the browser.
  const index = useSignal<SeasonIndexEntry[]>([])
  const loaded = useSignal<Record<string, RecentRun[]>>({})
  const status = useSignal<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const loadingMore = useSignal(false)
  const loadError = useSignal('')
  const seasonFilter = useSignal<string>('')
  const modeFilter = useSignal<GameMode | 'all'>('all')
  const statusFilter = useSignal<StatusFilter>('any')
  const pagedSeasons = useSignal(1)
  const openRun = useSignal<RecentRun | null>(null)
  const rowTriggerRef = useRef<HTMLElement | null>(null)

  // First read: the index plus the most recent season the player played.
  useEffect(() => {
    const token = sessionToken()
    if (!token) return
    const controller = new AbortController()
    index.value = []
    loaded.value = {}
    seasonFilter.value = ''
    pagedSeasons.value = 1
    status.value = 'loading'
    void getSeasonHistory(token, controller.signal, { placements: true })
      .then((response) => {
        index.value = response.index ?? response.seasons.map((season) => ({ id: season.id, games: season.games }))
        loaded.value = Object.fromEntries(response.seasons.map((season) => [season.id, season.runs]))
        status.value = 'ready'
      })
      .catch(() => {
        if (!controller.signal.aborted) status.value = 'error'
      })
    return () => controller.abort()
  }, [playerId, index, loaded, seasonFilter, pagedSeasons, status])

  const totalPlayed = index.value.reduce((sum, season) => sum + season.games, 0)
  const seasonIds = index.value.map((season) => season.id)
  const currentSeasonId = seasonIds[0] ?? ''
  const activeSeason = seasonFilter.value || currentSeasonId
  const viewingAll = activeSeason === 'all'
  const viewingCurrent = activeSeason === currentSeasonId

  // Which seasons the list is showing. Only the current-season view pages: a
  // specific season is one request, and All seasons is the one place a player
  // deliberately asks for everything.
  const scopedSeasonIds = viewingAll
    ? seasonIds
    : viewingCurrent
      ? seasonIds.slice(0, pagedSeasons.value)
      : [activeSeason]
  const missingSeasonIds = scopedSeasonIds.filter((id) => !(id in loaded.value))
  const nextOlderSeasonId = viewingCurrent ? seasonIds[pagedSeasons.value] : undefined

  async function fetchSeason(season: string): Promise<void> {
    const token = sessionToken()
    if (!token) return
    loadingMore.value = true
    loadError.value = ''
    // Every season in scope is marked loaded before the request resolves —
    // empty for now. A season with no runs, and a season whose request failed,
    // both have to stop being "missing" or the loader re-fires every render.
    const attempted = Object.fromEntries(scopedSeasonIds.map((id) => [id, loaded.value[id] ?? []]))
    try {
      const response = await getSeasonHistory(token, undefined, { season, placements: season !== 'all' })
      loaded.value = {
        ...loaded.value,
        ...attempted,
        ...Object.fromEntries(response.seasons.map((entry) => [entry.id, entry.runs]))
      }
    } catch (error) {
      loaded.value = { ...loaded.value, ...attempted }
      loadError.value = error instanceof Error ? error.message : 'Those games could not be loaded.'
    } finally {
      loadingMore.value = false
    }
  }

  // Selecting a season the browser has not fetched yet pulls exactly that one.
  useEffect(() => {
    if (status.value !== 'ready' || loadingMore.value || !missingSeasonIds.length) return
    void fetchSeason(viewingAll ? 'all' : missingSeasonIds[0])
  })

  const scopedRuns = scopedSeasonIds
    .flatMap((id) => loaded.value[id] ?? [])
    .filter((run) => modeFilter.value === 'all' || run.mode === modeFilter.value)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))

  // Season and mode bound what the tiles count; status is the filter the tiles
  // themselves toggle, so it is applied after they are counted.
  const counts = STATUS_TILES.map((tile) => ({
    ...tile,
    count: scopedRuns.filter((run) => run.reviewStatus === tile.key).length
  }))
  const visibleRuns = scopedRuns.filter(
    (run) => statusFilter.value === 'any' || run.reviewStatus === statusFilter.value
  )

  // Per-mode personal bests inside the loaded scope, so a row can mark itself
  // without rescanning the list once per row.
  const bestByMode = new Map<GameMode, number>()
  for (const mode of new Set(scopedRuns.map((run) => run.mode))) {
    const best = bestOf(scopedRuns, mode)
    if (best !== undefined) bestByMode.set(mode, best)
  }

  const months: Array<{ key: string; runs: RecentRun[] }> = []
  for (const run of visibleRuns) {
    const key = monthKey(run.completedAt)
    const group = months.at(-1)
    if (group?.key === key) group.runs.push(run)
    else months.push({ key, runs: [run] })
  }

  // `BEST · #7` — the second half is this run's board placement, which only the
  // run actually holding the player's position carries. An excluded run has no
  // placement to name.
  function noteFor(run: RecentRun): string {
    const place = run.placement === undefined ? '' : ` · #${run.placement}`
    if (run.reviewStatus === 'excluded') return 'EXCLUDED'
    if (run.reviewStatus === 'pending') return `AWAITING${place}`
    return bestByMode.get(run.mode) === run.score ? `BEST${place}` : ''
  }

  return (
    <section class="ed-profile__recent ed-games" aria-labelledby="your-games-title">
      <div class="ed-profile__recent-head">
        <span class="ed-profile__recent-title" id="your-games-title">
          Your games
        </span>
        <span class="ed-profile__recent-score">{totalPlayed.toLocaleString()} played</span>
      </div>

      <div class="ed-games__filters">
        <select
          aria-label="Season"
          value={activeSeason}
          onChange={(event) => {
            seasonFilter.value = event.currentTarget.value
            pagedSeasons.value = 1
          }}
        >
          {index.value.map((season) => (
            <option key={season.id} value={season.id}>
              {seasonLabel(season, season.id)} · {season.games}
            </option>
          ))}
          <option value="all">All seasons</option>
        </select>
        <select
          aria-label="Mode"
          value={modeFilter.value}
          onChange={(event) => (modeFilter.value = event.currentTarget.value as GameMode | 'all')}
        >
          <option value="all">All modes</option>
          {GAMES.map((game) => (
            <option key={game.mode} value={game.mode}>
              {game.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Review status"
          value={statusFilter.value}
          onChange={(event) => (statusFilter.value = event.currentTarget.value as StatusFilter)}
        >
          <option value="any">Any status</option>
          {STATUS_TILES.map((tile) => (
            <option key={tile.key} value={tile.key}>
              {tile.label}
            </option>
          ))}
        </select>
      </div>

      {/* The tiles are the filter, not a read-out beside it: tapping one sets
          the status filter and tapping it again clears it. They count referee
          decisions only — most games are never reviewed and belong to none. */}
      <div class="ed-games__tiles">
        {counts.map((tile) => (
          <button
            key={tile.key}
            class={`ed-games__tile ed-games__tile--${tile.key}${statusFilter.value === tile.key ? ' ed-games__tile--on' : ''}`}
            aria-pressed={statusFilter.value === tile.key}
            onClick={() => (statusFilter.value = statusFilter.value === tile.key ? 'any' : tile.key)}
          >
            <span class="ed-games__tile-count">
              <ReviewStatusMark status={tile.key} size={18} />
              <strong>{tile.count}</strong>
            </span>
            <span>{tile.label}</span>
          </button>
        ))}
      </div>

      {status.value === 'loading' || status.value === 'idle' ? (
        <p class="ed-profile__recent-empty" role="status">
          Loading your games…
        </p>
      ) : status.value === 'error' ? (
        <p class="ed-profile__recent-empty" role="alert">
          Your game history is temporarily unavailable.
        </p>
      ) : !visibleRuns.length ? (
        <EmptyState
          art="empty-runs"
          heading={scopedRuns.length ? 'Nothing matches those filters' : 'Nothing played yet'}
          line={
            scopedRuns.length
              ? 'Clear a filter to see the rest of your games.'
              : 'Your finished games land here, newest first.'
          }
          actionLabel={scopedRuns.length ? 'Clear filters' : 'Play Surge'}
          onAction={
            scopedRuns.length
              ? () => {
                  statusFilter.value = 'any'
                  modeFilter.value = 'all'
                }
              : undefined
          }
          href="/surge"
        />
      ) : (
        <>
          {months.map((month) => {
            const monthBest = modeFilter.value === 'all' ? undefined : bestOf(month.runs, modeFilter.value)
            return (
              <div class="ed-games__month" key={month.key}>
                <div class="ed-games__month-head">
                  <strong>{monthLabel(month.runs[0].completedAt)}</strong>
                  <small>
                    {month.runs.length} {month.runs.length === 1 ? 'game' : 'games'}
                    {monthBest !== undefined && ` · best ${scoreLabel(modeFilter.value as GameMode, monthBest)}`}
                  </small>
                </div>
                <ul class="ed-games__rows">
                  {month.runs.map((run, index) => {
                    const note = noteFor(run)
                    return (
                      <li key={run.runId}>
                        <button
                          class="ed-games__row"
                          aria-label={`${gameDisplay(run.mode).name}, ${scoreLabel(run.mode, run.score)}`}
                          onClick={(event) => {
                            rowTriggerRef.current = event.currentTarget
                            openRun.value = run
                          }}
                        >
                          <span class="ed-games__day">{dayLabel(run.completedAt)}</span>
                          <ModeIcon mode={run.mode} size={22} />
                          <span class="ed-games__score">{scoreLabel(run.mode, run.score)}</span>
                          <span class={`ed-games__note ed-games__note--${run.reviewStatus ?? 'none'}`}>{note}</span>
                          {/* No referee, no seal: the mark means a person
                              looked at this run, so an ordinary game wears
                              nothing at all. */}
                          {run.reviewStatus && <ReviewStatusMark status={run.reviewStatus} size={18} index={index} />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
          {loadError.value && (
            <p class="ed-profile__recent-empty" role="alert">
              {loadError.value}
            </p>
          )}
          {nextOlderSeasonId && (
            <button class="ed-games__more" disabled={loadingMore.value} onClick={() => (pagedSeasons.value += 1)}>
              {loadingMore.value
                ? 'Loading…'
                : `Load ${seasonLabel(
                    index.value.find((season) => season.id === nextOlderSeasonId),
                    nextOlderSeasonId
                  )}`}
            </button>
          )}
        </>
      )}

      {openRun.value && (
        <RunDetail run={openRun.value} onClose={() => (openRun.value = null)} returnFocus={rowTriggerRef.current} />
      )}
    </section>
  )
}

function RunDetail({
  run,
  onClose,
  returnFocus
}: {
  run: RecentRun
  onClose: () => void
  returnFocus: HTMLElement | null
}) {
  const game = gameDisplay(run.mode)
  return (
    <DetailModal label={`${game.name} game`} onClose={onClose} className="ed-run-modal" returnFocus={returnFocus}>
      <div class="ed-run-modal__head">
        <ModeIcon mode={run.mode} size={34} />
        <div>
          <h2 class="ed-run-modal__title">{game.name}</h2>
          <p>
            {scoreLabel(run.mode, run.score)} ·{' '}
            {new Date(run.completedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>
        {run.reviewStatus && <ReviewStatusMark status={run.reviewStatus} size={32} label />}
      </div>
      {/* Only a run a referee has actually touched carries a reference: on an
          ordinary game it is a serial number with nothing to look up. */}
      {run.reviewStatus && <p class="ed-run-modal__reference">Run {runReference(run.runId)}</p>}
      {run.reviewExplanation && <p class="ed-run-modal__note">{run.reviewExplanation}</p>}
      {run.reviewStatus === 'excluded' && (
        <a class="ed-textlink" href={contactEmailHref(`Elixir Drop run review ${runReference(run.runId)}`)}>
          Dispute this result
        </a>
      )}
    </DetailModal>
  )
}
