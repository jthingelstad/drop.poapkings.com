import { useSignal } from '@preact/signals'
import { playerReference, runReference } from '@elixir-drop/contracts'
import type { GameMode } from '@elixir-drop/contracts'
import { useEffect, useRef } from 'preact/hooks'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import ScopeRow from '../components/ScopeRow'
import CauseChip from '../components/CauseChip'
import ReviewStatusMark from '../components/ReviewStatus'
import BadgeMedallion from '../components/BadgeMedallion'
import {
  accountStatus,
  badges,
  deleteAccount,
  markUpdatesOpened,
  player,
  recentRuns,
  refreshAccount,
  sessionToken,
  signOut,
  updateAccount
} from '../lib/account'
import { getNameOptions } from '../lib/api'
import { getSeasonHistory, type RecentRun, type SeasonIndexEntry } from '../lib/api'
import { allCards } from '../lib/card-catalog'
import { challengeCard } from '../lib/challenge-cards'
import { badgeViews } from '../lib/badges'
import EmptyState from '../components/EmptyState'
import ModeIcon from '../components/ModeIcon'
import SkeletonRows from '../components/Skeleton'
import { gameDisplay, LOWER_IS_BETTER, scoreLabel } from '../lib/game-metadata'
import { gameReturnPathFromRoute } from '../lib/game-routes'
import { contactEmailHref } from '../lib/links'
import { navigate, route } from '../lib/router'
import { buildMeta } from '../lib/build'
import { standaloneApp } from '../lib/pwa-install'
import { getSettings, saveSettings } from '../lib/storage'
import type { InputStyle } from '../types'
import PlayerPreferences from '../components/PlayerPreferences'
import DetailModal from '../components/DetailModal'
import { editorialEntries, isUnread, hasUnreadUpdates, type UpdateEntry } from '../lib/updates'

const favoriteCards = [...allCards].sort((left, right) => left.name.localeCompare(right.name))

type YouScope = 'log' | 'updates' | 'settings' | 'account'

// `3y 41d playing` — compact enough to sit on one line with the tag.
function accountAgeText(years: number | undefined, days: number | undefined): string {
  if (days !== undefined) {
    const fullYears = Math.floor(days / 365)
    const remainder = days % 365
    return fullYears ? `${fullYears}y ${remainder}d playing` : `${remainder}d playing`
  }
  if (years !== undefined) return `${years}y playing`
  return 'Account age unavailable'
}

function joinedText(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

const CR_LOADING_MESSAGE = 'Player tag saved. Loading its public Clash Royale profile…'

export default function Profile() {
  const profileRoute = route.value
  const returnTo = gameReturnPathFromRoute(profileRoute)
  const tag = useSignal(player.value?.playerTag || '')
  const search = useSignal('')
  const selectedCardId = useSignal<number | null>(player.value?.favoriteCardId ?? null)
  const editingIdentity = useSignal(!player.value?.favoriteCardId)
  const scope = useSignal<YouScope>('log')
  const names = useSignal<string[]>([])
  const nameToken = useSignal('')
  const busy = useSignal(false)
  const message = useSignal('')
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

  // Opening Updates stamps the read time server-side, clearing the unread dot.
  useEffect(() => {
    if (scope.value === 'updates' && hasUnreadUpdates.value) void markUpdatesOpened()
  }, [scope.value])

  if (accountStatus.value !== 'authenticated' || !player.value) {
    return (
      <div class="ed-profile-guest">
        <span class="ed-profile-guest__halo" aria-hidden="true">
          <span class="ed-drop-shape ed-profile-guest__drop" />
        </span>
        <div>
          <h1 class="ed-h1">You</h1>
          <p class="ed-profile-guest__lede">
            Sign in to save your games, earn badges, and climb the seasonal leaderboards.
          </p>
        </div>
        <button class="ed-btn ed-btn--gold ed-btn--lg tap-fx" onClick={() => navigate('/login')}>
          <span class="tap-face">Sign In</span>
        </button>
        <div class="ed-profile-guest__note">No password — we email you a one-tap link.</div>
        <button class="ed-textlink" onClick={() => navigate('/')}>
          Keep playing as guest
        </button>
      </div>
    )
  }

  const current = player.value
  const isInitialSetup = current.favoriteCardId === undefined
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
      await updateAccount({ favoriteCardId: selectedCard.id, publicName: name, nameToken: nameToken.value })
      names.value = []
      editingIdentity.value = false
      if (returnTo) {
        navigate(returnTo)
      } else if (isInitialSetup) {
        navigate('/')
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

        {isInitialSetup && (
          <p class="ed-edit__note">
            Choose a Player Card, then pick a generated name. You can add a Clash Royale tag later.
            {returnTo ? ' You’ll return to your game when setup is complete.' : ''}
          </p>
        )}

        <section class="ed-edit__section">
          <div class="ed-edit__section-title">{isInitialSetup ? '1. Choose your Player Card' : 'Player Card'}</div>
          <p class="ed-edit__section-sub">This card becomes your avatar and inspires your player name.</p>
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
          <div class="ed-edit__section-title">{isInitialSetup ? '2. Choose your player name' : 'Player name'}</div>
          <p class="ed-edit__section-sub">
            {selectedCard
              ? `Inspired by ${selectedCard.name}. Generate a set and pick your favorite.`
              : 'Choose a Player Card above, then generate a set of player names.'}
          </p>
          <button
            class="ed-btn ed-btn--gold ed-btn--sm tap-fx"
            onClick={() => void loadNames()}
            disabled={busy.value || !selectedCard}
          >
            <span class="tap-face">
              <Icon name="sparkles" />{' '}
              {busy.value
                ? 'Getting ideas…'
                : !selectedCard
                  ? 'Choose a Player Card first'
                  : names.value.length
                    ? 'More name ideas'
                    : 'Get name ideas'}
            </span>
          </button>
          {names.value.length > 0 && (
            <>
              {isInitialSetup && <p class="ed-edit__section-sub">Pick a name to finish setup.</p>}
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
            </>
          )}
        </section>

        {!isInitialSetup && (
          <section class="ed-edit__section">
            <div class="ed-edit__section-title">Clash Royale player tag (optional)</div>
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
        )}

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

  // ── You view: identity header + scope row ────────────────────────────────
  return (
    <div class="ed-you">
      <CauseChip />
      <header class="ed-you__identity">
        <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
        <div class="ed-you__ident-text">
          <div class="ed-you__name">{current.publicName || 'Choose a favorite card'}</div>
          <div class="ed-you__ident-line">
            {[currentCard ? `${currentCard.name} · Player Card` : 'Pick a Player Card', playerReference(current.id)]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <button class="ed-profile__edit tap-fx" onClick={beginIdentityEdit}>
          <span class="tap-face">
            <Icon name="pencil" /> Edit
          </span>
        </button>
      </header>

      <ScopeRow
        ariaLabel="Choose a You scope"
        active={scope.value}
        onSelect={(key) => (scope.value = key)}
        options={[
          { key: 'log', label: 'Log' },
          { key: 'updates', label: 'Updates', dot: hasUnreadUpdates.value },
          { key: 'settings', label: 'Settings' },
          { key: 'account', label: 'Account' }
        ]}
      />

      {message.value && (
        <div class="ed-edit__msg" role="status">
          {message.value}
        </div>
      )}

      {scope.value === 'log' && <LogScope playerId={current.id} />}
      {scope.value === 'updates' && <UpdatesScope />}
      {scope.value === 'settings' && <SettingsScope />}
      {scope.value === 'account' && <AccountScope current={current} />}
    </div>
  )
}

// ── Log scope ───────────────────────────────────────────────────────────────

function localDayKey(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayHeadLabel(iso: string, todayKey: string): string {
  const date = new Date(iso)
  const label = date
    .toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
    .toLocaleUpperCase()
  return localDayKey(iso) === todayKey ? `TODAY · ${label}` : label
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function bestOf(runs: RecentRun[], mode: GameMode): number | undefined {
  const scores = runs.filter((run) => run.mode === mode).map((run) => run.score)
  if (!scores.length) return undefined
  return LOWER_IS_BETTER.has(mode) ? Math.min(...scores) : Math.max(...scores)
}

// The best of a day, but only when every run that day is the same mode — a
// mixed-mode "best" would compare seconds to streaks.
function dayBest(runs: RecentRun[]): string | undefined {
  const mode = runs[0].mode
  if (!runs.every((run) => run.mode === mode)) return undefined
  const best = bestOf(runs, mode)
  return best === undefined ? undefined : scoreLabel(mode, best)
}

function LogScope({ playerId }: { playerId: string }) {
  const index = useSignal<SeasonIndexEntry[]>([])
  const loaded = useSignal<Record<string, RecentRun[]>>({})
  const status = useSignal<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const loadingMore = useSignal(false)
  const loadError = useSignal('')
  const pagedSeasons = useSignal(1)
  const flaggedOnly = useSignal(false)
  const openRun = useSignal<RecentRun | null>(null)
  const rowTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const token = sessionToken()
    if (!token) return
    const controller = new AbortController()
    index.value = []
    loaded.value = {}
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
  }, [playerId, index, loaded, pagedSeasons, status])

  const totalPlayed = index.value.reduce((sum, season) => sum + season.games, 0)
  const seasonIds = index.value.map((season) => season.id)
  const scopedSeasonIds = seasonIds.slice(0, pagedSeasons.value)
  const missingSeasonIds = scopedSeasonIds.filter((id) => !(id in loaded.value))
  const nextOlderSeasonId = seasonIds[pagedSeasons.value]

  async function fetchSeason(season: string): Promise<void> {
    const token = sessionToken()
    if (!token) return
    loadingMore.value = true
    loadError.value = ''
    const attempted = Object.fromEntries(scopedSeasonIds.map((id) => [id, loaded.value[id] ?? []]))
    try {
      const response = await getSeasonHistory(token, undefined, { season, placements: true })
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

  useEffect(() => {
    if (status.value !== 'ready' || loadingMore.value || !missingSeasonIds.length) return
    void fetchSeason(missingSeasonIds[0])
  })

  const allRuns = scopedSeasonIds
    .flatMap((id) => loaded.value[id] ?? [])
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  const flaggedCount = allRuns.filter((run) => run.reviewStatus).length
  const visibleRuns = flaggedOnly.value ? allRuns.filter((run) => run.reviewStatus) : allRuns

  // Per-mode personal bests inside the loaded scope, so a row marks itself
  // without rescanning the list per row.
  const bestByMode = new Map<GameMode, number>()
  for (const mode of new Set(allRuns.map((run) => run.mode))) {
    const best = bestOf(allRuns, mode)
    if (best !== undefined) bestByMode.set(mode, best)
  }

  const todayKey = localDayKey(new Date().toISOString())
  const days: Array<{ key: string; runs: RecentRun[] }> = []
  for (const run of visibleRuns) {
    const key = localDayKey(run.completedAt)
    const group = days.at(-1)
    if (group?.key === key) group.runs.push(run)
    else days.push({ key, runs: [run] })
  }

  function noteFor(run: RecentRun): string {
    const place = run.placement === undefined ? '' : ` · #${run.placement}`
    if (run.reviewStatus === 'excluded') return 'EXCLUDED'
    if (run.reviewStatus === 'pending') return `AWAITING${place}`
    return bestByMode.get(run.mode) === run.score ? `BEST${place}` : ''
  }

  return (
    <section class="ed-games" aria-labelledby="your-games-title">
      <div class="ed-you__scope-head">
        <span class="ed-you__scope-title" id="your-games-title">
          Log
        </span>
        <span class="ed-you__scope-meta">{totalPlayed.toLocaleString()} played</span>
      </div>

      <div class="ed-games__chips" role="group" aria-label="Filter your games">
        <button
          class={`ed-filterchip${!flaggedOnly.value ? ' ed-filterchip--on' : ''}`}
          aria-pressed={!flaggedOnly.value}
          onClick={() => (flaggedOnly.value = false)}
        >
          All
        </button>
        <button
          class={`ed-filterchip ed-filterchip--flagged${flaggedOnly.value ? ' ed-filterchip--on' : ''}`}
          aria-pressed={flaggedOnly.value}
          onClick={() => (flaggedOnly.value = !flaggedOnly.value)}
        >
          <span class="ed-filterchip__ring" aria-hidden="true" />
          Flagged {flaggedCount}
        </button>
      </div>

      {status.value === 'loading' || status.value === 'idle' ? (
        <SkeletonRows count={6} className="ed-skeleton--log" />
      ) : status.value === 'error' ? (
        <p class="ed-profile__recent-empty" role="alert">
          Your game history is temporarily unavailable.
        </p>
      ) : !visibleRuns.length ? (
        <EmptyState
          art="empty-runs"
          heading={flaggedOnly.value ? 'No flagged games' : 'Nothing played yet'}
          line={
            flaggedOnly.value
              ? 'Games a referee has looked at show up here.'
              : 'Your finished games land here, newest first.'
          }
          actionLabel={flaggedOnly.value ? 'Show all games' : 'Play Surge'}
          onAction={flaggedOnly.value ? () => (flaggedOnly.value = false) : undefined}
          href="/surge"
        />
      ) : (
        <>
          {days.map((day) => {
            const best = dayBest(day.runs)
            return (
              <div class="ed-games__day-group" key={day.key}>
                <div class="ed-games__day-head">
                  <strong>{dayHeadLabel(day.runs[0].completedAt, todayKey)}</strong>
                  <small>
                    {day.runs.length} {day.runs.length === 1 ? 'game' : 'games'}
                    {best !== undefined && ` · best ${best}`}
                  </small>
                </div>
                <ul class="ed-games__rows">
                  {day.runs.map((run, index) => {
                    const note = noteFor(run)
                    return (
                      <li key={run.runId}>
                        <button
                          class="ed-games__row"
                          aria-label={`${gameDisplay(run.mode).name}, ${scoreLabel(run.mode, run.score)} at ${localTime(run.completedAt)}`}
                          onClick={(event) => {
                            rowTriggerRef.current = event.currentTarget
                            openRun.value = run
                          }}
                        >
                          <span class="ed-games__time">{localTime(run.completedAt)}</span>
                          <ModeIcon mode={run.mode} size={22} />
                          <span class="ed-games__score">{scoreLabel(run.mode, run.score)}</span>
                          <span class={`ed-games__note ed-games__note--${run.reviewStatus ?? 'none'}`}>{note}</span>
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
          <p class="ed-games__tz-note">Days are your local time. Seasons close on UTC.</p>
          {nextOlderSeasonId && (
            <button class="ed-games__more" disabled={loadingMore.value} onClick={() => (pagedSeasons.value += 1)}>
              {loadingMore.value ? 'Loading…' : 'Older games'}
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

// ── Updates scope ────────────────────────────────────────────────────────────

function UpdatesScope() {
  const openRun = useSignal<RecentRun | null>(null)
  const rowTriggerRef = useRef<HTMLElement | null>(null)
  const lastOpened = player.value?.lastOpenedUpdates
  const entries = editorialEntries()
  const withReferee = recentRuns.value.filter((run) => run.reviewStatus === 'pending')
  // Rungs cleared: the badges the player has earned, strongest first, as pointer
  // rows. No per-rung timestamp exists, so these are shown but not time-merged.
  const earnedViews = badgeViews(badges.value)
    .filter((view) => view.earned)
    .slice(0, 6)

  return (
    <section class="ed-updates" aria-labelledby="updates-title">
      <div class="ed-you__scope-head">
        <span class="ed-you__scope-title" id="updates-title">
          Updates
        </span>
      </div>

      {/* Tier 5: the player-tag prompt is a card here, never an unbidden modal.
          It waits to be found — shown only when a signed-in player has no tag. */}
      {player.value && !player.value.playerTag && (
        <div class="ed-updates__tagcard">
          <span class="ed-updates__tagcard-icon" aria-hidden="true">
            <Icon name="user" />
          </span>
          <div class="ed-updates__tagcard-text">
            <strong>Add your player tag</strong>
            <small>Link your public Clash Royale profile so Drop can show your clan and clan rankings.</small>
          </div>
          <button class="ed-btn ed-btn--gold ed-btn--sm" onClick={() => navigate('/profile?edit=player-tag')}>
            Add tag
          </button>
        </div>
      )}

      {withReferee.length > 0 && (
        <div class="ed-updates__referee">
          <div class="ed-updates__referee-head">
            <span class="ed-updates__referee-ring" aria-hidden="true" />
            With the referee
          </div>
          <ul class="ed-updates__referee-list">
            {withReferee.map((run) => (
              <li key={run.runId}>
                <button
                  class="ed-updates__referee-run"
                  onClick={(event) => {
                    rowTriggerRef.current = event.currentTarget
                    openRun.value = run
                  }}
                >
                  <ModeIcon mode={run.mode} size={24} />
                  <span>{gameDisplay(run.mode).name}</span>
                  <span class="ed-updates__referee-score">{scoreLabel(run.mode, run.score)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p class="ed-updates__referee-note">Both rank while they are checked. This slot becomes the verdict.</p>
        </div>
      )}

      <ul class="ed-updates__list">
        {entries.map((entry) => (
          <UpdateRow key={entry.id} entry={entry} unread={isUnread(entry.date, lastOpened)} />
        ))}
      </ul>

      {earnedViews.length > 0 && (
        <div class="ed-updates__rungs">
          <div class="ed-updates__rungs-head">Rungs you’ve cleared</div>
          <ul class="ed-updates__rungs-list">
            {earnedViews.map((view) => (
              <li key={view.slug}>
                <button class="ed-updates__rung" onClick={() => navigate('/leaderboards')}>
                  <BadgeMedallion badge={view} size={40} />
                  <span class="ed-updates__rung-text">
                    <strong>{view.name}</strong>
                    {view.chip && <small>{view.chip}</small>}
                  </span>
                  <Icon name="chevron-right" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openRun.value && (
        <RunDetail run={openRun.value} onClose={() => (openRun.value = null)} returnFocus={rowTriggerRef.current} />
      )}
    </section>
  )
}

function UpdateRow({ entry, unread }: { entry: UpdateEntry; unread: boolean }) {
  const open = useSignal(false)
  const dateLabel = new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  return (
    <li class={`ed-update${unread ? ' ed-update--unread' : ''}`}>
      <button class="ed-update__head" aria-expanded={open.value} onClick={() => (open.value = !open.value)}>
        {unread && <span class="ed-update__dot" aria-label="Unread" />}
        <span class="ed-update__title">{entry.title}</span>
        <span class="ed-update__date">{dateLabel}</span>
        <Icon name={open.value ? 'chevron-up' : 'chevron-down'} />
      </button>
      {open.value && (
        <div class="ed-update__body">
          {entry.body.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}
    </li>
  )
}

// ── Settings scope ───────────────────────────────────────────────────────────

function SettingsScope() {
  const inputStyle = useSignal<InputStyle>(getSettings().inputStyle)

  function setInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

  return (
    <section class="ed-settings" aria-labelledby="settings-title">
      <div class="ed-you__scope-head">
        <span class="ed-you__scope-title" id="settings-title">
          Settings
        </span>
      </div>

      <div class="setting-row">
        <div class="setting-row__text">
          <div class="setting-row__name">Practice input</div>
          <div class="setting-row__desc">How you answer in Practice. Surge always uses the keypad.</div>
        </div>
        <div class="input-toggle">
          <button
            class={`input-toggle__btn${inputStyle.value === 'keypad' ? ' input-toggle__btn--active' : ''}`}
            onClick={() => setInput('keypad')}
            aria-pressed={inputStyle.value === 'keypad'}
          >
            Keypad
          </button>
          <button
            class={`input-toggle__btn${inputStyle.value === 'choice' ? ' input-toggle__btn--active' : ''}`}
            onClick={() => setInput('choice')}
            aria-pressed={inputStyle.value === 'choice'}
          >
            4 choices
          </button>
        </div>
      </div>

      <PlayerPreferences />

      <p class="ed-settings__note">Preferences are per-device and never sync.</p>
    </section>
  )
}

// ── Account scope ────────────────────────────────────────────────────────────

const ABOUT_LINKS: Array<{ label: string; href?: string; to?: string; standaloneTo?: string }> = [
  { label: 'About', href: '/about/' },
  { label: 'Releases', href: '/releases/' },
  { label: 'FAQ', href: '/faq/' },
  { label: 'Fair Play', href: '/fair-play/' },
  { label: 'Discord', href: '/discord/' },
  { label: 'Privacy', href: '/privacy/' }
]

function AccountScope({ current }: { current: NonNullable<(typeof player)['value']> }) {
  const deletionOpen = useSignal(false)
  const deletionConfirmation = useSignal('')
  const deletingAccount = useSignal(false)
  const deletionError = useSignal('')
  const clan = current.clashRoyale?.clan

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

  const gameSetup: { label: string; href?: string; to?: string } = standaloneApp.value
    ? { label: 'App Info', to: '/app-info' }
    : { label: 'Game Setup', href: '/install/' }
  const aboutRows = [...ABOUT_LINKS.slice(0, 4), gameSetup, ...ABOUT_LINKS.slice(4)]

  return (
    <section class="ed-account" aria-labelledby="account-title">
      <div class="ed-you__scope-head">
        <span class="ed-you__scope-title" id="account-title">
          Account
        </span>
      </div>

      <div class="ed-account__block">
        <div class="ed-account__label">Signed in as</div>
        <div class="ed-account__line">{current.email}</div>
        <div class="ed-account__line ed-account__muted">
          Player <span class="ed-profile__reference">{playerReference(current.id)}</span> · Joined{' '}
          {joinedText(current.createdAt)}
        </div>
        <div class="ed-account__actions">
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
            <>
              <p class="ed-danger__sub">
                Removes your email, Drop identity, saved player tag, game history, and leaderboard entries. This
                can&rsquo;t be undone.
              </p>
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
            </>
          )}
        </div>
      </div>

      {current.clashRoyale && (
        <div class="ed-account__block">
          <div class="ed-account__label">Clash Royale</div>
          {current.clashRoyale.status === 'ready' ? (
            <>
              <div class="ed-account__line">{clan?.name ?? current.clashRoyale.name ?? 'No clan'}</div>
              <div class="ed-account__line ed-account__muted">
                {[
                  current.clashRoyale.tag,
                  accountAgeText(current.clashRoyale.accountAge?.years, current.clashRoyale.accountAge?.days)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </>
          ) : (
            <div class="ed-account__line ed-account__muted">
              {current.clashRoyale.status === 'pending'
                ? `Loading ${current.clashRoyale.tag}…`
                : current.clashRoyale.status === 'not_found'
                  ? `Clash Royale could not find ${current.clashRoyale.tag}.`
                  : 'Profile refresh delayed. Drop will retry automatically.'}
            </div>
          )}
        </div>
      )}

      <div class="ed-account__block">
        <div class="ed-account__label">About Drop</div>
        <div class="ed-account__links">
          {aboutRows.map((row) =>
            row.href ? (
              <a class="ed-account__link" key={row.label} href={row.href}>
                {row.label}
              </a>
            ) : (
              <button class="ed-account__link" key={row.label} onClick={() => navigate(row.to!)}>
                {row.label}
              </button>
            )
          )}
        </div>
        <div class="ed-account__version">
          Build <code>{buildMeta.id}</code> · {buildMeta.dateLabel}
        </div>
      </div>
    </section>
  )
}

// ── Run sheet ────────────────────────────────────────────────────────────────

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
  const copied = useSignal(false)
  const reference = runReference(run.runId)

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference)
      copied.value = true
      window.setTimeout(() => (copied.value = false), 1600)
    } catch {
      // Clipboard denied — the reference is still visible to select by hand.
    }
  }

  const placement = run.placement === undefined ? '' : `#${run.placement}`

  return (
    <DetailModal label={`${game.name} game`} onClose={onClose} className="ed-run-modal" returnFocus={returnFocus}>
      <div class="ed-run-modal__head">
        <ModeIcon mode={run.mode} size={34} />
        <div>
          <h2 class="ed-run-modal__title">{game.name}</h2>
          <p>
            {new Date(run.completedAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            })}
          </p>
        </div>
      </div>

      <div class="ed-run-modal__scorerow">
        <span class="ed-run-modal__score">{scoreLabel(run.mode, run.score)}</span>
        {placement && <span class="ed-run-modal__place">{placement}</span>}
        {run.reviewStatus && <ReviewStatusMark status={run.reviewStatus} size={32} label />}
      </div>

      {run.xp !== undefined && run.xp > 0 && (
        <div class="ed-run-modal__xp">
          <Icon name="zap" /> XP earned <strong>+{run.xp}</strong>
        </div>
      )}

      {run.reviewStatus === 'excluded' ? (
        <>
          {run.reviewExplanation && <p class="ed-run-modal__note">{run.reviewExplanation}</p>}
          <a class="ed-textlink" href={contactEmailHref(`Elixir Drop run review ${reference}`)}>
            Dispute this result
          </a>
        </>
      ) : (
        <div class="ed-run-modal__ref">
          <code>{reference}</code>
          <button class="ed-textlink" onClick={() => void copyReference()}>
            {copied.value ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </DetailModal>
  )
}
