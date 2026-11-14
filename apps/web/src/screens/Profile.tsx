import { useSignal } from '@preact/signals'
import {
  ELIXIR_RETURN_PATH,
  normalizeAuthReturnPath,
  PLAYER_TAG_RETURN_PATH,
  playerReference,
  profileRouteForScope,
  runReference,
  youScopeFromRoute,
  type YouScope
} from '@elixir-drop/contracts'
import type { GameMode } from '@elixir-drop/contracts'
import { useEffect, useRef } from 'preact/hooks'
import PlayerAvatar from '../components/PlayerAvatar'
import { PUBLIC_NAME_FALLBACK } from '../lib/display-name'
import Icon from '../components/Icon'
import ScopeRow from '../components/ScopeRow'
import CauseChip from '../components/CauseChip'
import AccountTags from '../components/AccountTags'
import BadgeMedallion from '../components/BadgeMedallion'
import { accountStatus, badges, deleteAccount, markUpdatesOpened, player, sessionToken, signOut } from '../lib/account'
import { getSeasonHistory, type RecentRun, type SeasonIndexEntry } from '../lib/api'
import { badgeViews, type BadgeView } from '../lib/badges'
import { BadgeSheet } from '../components/BadgeGrid'
import EmptyState from '../components/EmptyState'
import ModeIcon from '../components/ModeIcon'
import SkeletonRows from '../components/Skeleton'
import { gameDisplay, LOWER_IS_BETTER, scoreLabel } from '../lib/game-metadata'
import { canonicalProfileRoute, loginRouteForReturnPath } from '../lib/game-routes'
import { contactEmailHref } from '../lib/links'
import { navigate, replace, route, routePathname } from '../lib/router'
import { buildMeta } from '../lib/build'
import { standaloneApp } from '../lib/pwa-install'
import { getSettings, saveSettings } from '../lib/storage'
import type { InputStyle } from '../types'
import PlayerPreferences from '../components/PlayerPreferences'
import ElixirConnection, { ELIXIR_URL } from '../components/ElixirConnection'
import DetailModal from '../components/DetailModal'
import UpdateMarkdown from '../components/UpdateMarkdown'
import ShareLine from '../components/ShareLine'
import ShareAction from '../components/ShareAction'
import {
  editorialEntries,
  isUnread,
  hasUnreadUpdates,
  updatesError,
  updatesLoading,
  type UpdateEntry
} from '../lib/updates'
import { prepareProfileShare } from '../lib/share-profile'
import { track } from '../lib/analytics'

function joinedText(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export default function Profile() {
  const profileRoute = route.value
  const scope = youScopeFromRoute(profileRoute)
  const unreadUpdates = hasUnreadUpdates.value
  const message = useSignal('')
  useEffect(() => {
    if (routePathname(profileRoute) !== '/profile' || route.peek() !== profileRoute) return
    const canonical = canonicalProfileRoute(profileRoute)
    if (profileRoute !== canonical) replace(canonical)
  }, [profileRoute])

  // The old "choose your Clash Royale player" link (Account → step 3) has
  // nothing to choose any more: Drop shows the primary player on the Elixir
  // account (2026-11-14), so it opens Account's Elixir section.
  useEffect(() => {
    if (canonicalProfileRoute(profileRoute) === PLAYER_TAG_RETURN_PATH) replace(ELIXIR_RETURN_PATH)
  }, [profileRoute])

  // Opening Updates stamps the read time server-side, clearing the unread dot.
  useEffect(() => {
    if (scope === 'updates' && unreadUpdates) void markUpdatesOpened()
  }, [scope, unreadUpdates])

  if (accountStatus.value !== 'authenticated' || !player.value) {
    return (
      <div class="ed-profile-guest">
        <span class="ed-profile-guest__halo" aria-hidden="true">
          <span class="ed-drop-shape ed-profile-guest__drop" />
        </span>
        <div>
          <div class="ed-h1" aria-hidden="true">
            You
          </div>
          <p class="ed-profile-guest__lede">
            Sign in to save your games, earn badges, and climb the seasonal leaderboards.
          </p>
        </div>
        <button
          class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
          onClick={() => {
            const returnPath = normalizeAuthReturnPath(profileRoute)
            navigate(returnPath ? loginRouteForReturnPath(returnPath) : '/login')
          }}
        >
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

  // The name and picture come from the person's Elixir account at each sign-in
  // (2026-11-14): the Clash Royale name of its primary player and the profile
  // picture set there. There is nothing to choose in Drop.
  // ── You view: identity header + scope row ────────────────────────────────
  return (
    <div class="ed-you">
      <CauseChip />
      <header class="ed-you__identity">
        <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
        <div class="ed-you__ident-text">
          <div class="ed-you__name">
            <span>{current.publicName || PUBLIC_NAME_FALLBACK}</span>
            <AccountTags tags={current.accountTags} />
          </div>
          <div class="ed-you__ident-line">{playerReference(current.id)}</div>
        </div>
        <div class="ed-you__identity-actions">
          <ShareAction
            prepare={prepareProfileShare}
            className="ed-link-action ed-link-action--profile"
            buttonClassName="ed-profile__edit"
            onComplete={() => track('profile.shared')}
          />
          <a
            class="ed-profile__edit tap-fx"
            href={ELIXIR_URL}
            rel="noreferrer"
            title="Your name and picture come from Elixir"
          >
            <span class="tap-face">
              <Icon name="pencil" /> Edit on Elixir
            </span>
          </a>
        </div>
      </header>

      <ScopeRow
        ariaLabel="Choose a You scope"
        active={scope}
        onSelect={(scope: YouScope) => replace(profileRouteForScope(scope))}
        options={[
          { key: 'log', label: 'Log' },
          { key: 'updates', label: 'Updates', dot: unreadUpdates },
          { key: 'settings', label: 'Settings' },
          { key: 'account', label: 'Account' }
        ]}
      />

      {message.value && (
        <div class="ed-edit__msg" role="status">
          {message.value}
        </div>
      )}

      {scope === 'log' && <LogScope playerId={current.id} />}
      {scope === 'updates' && <UpdatesScope />}
      {scope === 'settings' && <SettingsScope />}
      {scope === 'account' && <AccountScope current={current} />}
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

  async function fetchSeason(season: number): Promise<void> {
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
          Excluded {flaggedCount}
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
          heading={flaggedOnly.value ? 'No excluded games' : 'Nothing played yet'}
          line={
            flaggedOnly.value
              ? 'A game a person removed from the boards would show up here.'
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
                  {day.runs.map((run) => {
                    const note = noteFor(run)
                    return (
                      <li key={run.runId}>
                        <button
                          class="ed-games__row"
                          onClick={(event) => {
                            rowTriggerRef.current = event.currentTarget
                            openRun.value = run
                          }}
                        >
                          <span class="ed-games__time">{localTime(run.completedAt)}</span>
                          <ModeIcon mode={run.mode} size={22} />
                          <span class="sr-only">{gameDisplay(run.mode).name}</span>
                          <span class="ed-games__score">{scoreLabel(run.mode, run.score)}</span>
                          <span class={`ed-games__note ed-games__note--${run.reviewStatus ?? 'none'}`}>{note}</span>
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
  const lastOpened = player.value?.lastOpenedUpdates
  const entries = editorialEntries()
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
            <strong>No Clash Royale player yet</strong>
            <small>
              Drop shows the primary player on your Elixir account, with its clan and clan rankings. Add one on Elixir,
              then sign in again.
            </small>
          </div>
          <button class="ed-btn ed-btn--gold ed-btn--sm" onClick={() => navigate('/profile?edit=player-tag')}>
            Open Account
          </button>
        </div>
      )}

      <ul class="ed-updates__list">
        {entries.map((entry, index) => (
          <UpdateRow key={entry.id} entry={entry} unread={isUnread(entry.publishedAt, lastOpened, index)} />
        ))}
      </ul>

      {updatesLoading.value && entries.length === 0 && <SkeletonRows count={3} className="ed-updates__loading" />}
      {updatesError.value && (
        <p class="ed-updates__status" role="status">
          {updatesError.value}
        </p>
      )}

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
    </section>
  )
}

function UpdateRow({ entry, unread }: { entry: UpdateEntry; unread: boolean }) {
  // Capture the unread state from the first render. Opening the scope stamps the
  // account read time immediately, but a fresh card should stay face-up for this
  // visit even after that response clears its unread dot.
  const open = useSignal(unread)
  const dateLabel = new Date(entry.publishedAt).toLocaleDateString(undefined, {
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
          <UpdateMarkdown body={entry.body} />
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
  { label: 'Updates', href: '/updates/' },
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

  const gameSetup: { label: string; href?: string; to?: string } =
    standaloneApp.value || current.accountTags?.includes('developer')
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
              <div class="ed-account__line ed-account__muted">{current.clashRoyale.tag}</div>
            </>
          ) : (
            // Drop reads a player's name and clan from Elixir only when you sign
            // in with Elixir (2026-11-13); it never fetches one in the background.
            <div class="ed-account__line ed-account__muted">
              {`${current.clashRoyale.tag}: sign in with Elixir again to show its name and clan.`}
            </div>
          )}
        </div>
      )}

      <ElixirConnection player={current} />

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
  const reference = runReference(run.runId)
  const openBadge = useSignal<BadgeView | null>(null)
  const rungTriggerRef = useRef<HTMLButtonElement | null>(null)
  // The badges this run moved a rung on, resolved to the player's current badge
  // view so the medallion shows the tier they now stand at. Opening one shows the
  // same badge sheet the wall uses.
  const rungViews = (() => {
    if (!run.rungs?.length) return []
    const views = badgeViews(badges.value)
    return run.rungs
      .map((slug) => views.find((view) => view.slug === slug))
      .filter((view): view is BadgeView => Boolean(view))
  })()

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
        {run.reviewStatus === 'excluded' && <span class="ed-run-modal__place">Excluded</span>}
      </div>

      {run.xp !== undefined && run.xp > 0 && (
        <div>
          <div class="ed-run-modal__xp">
            <Icon name="zap" /> XP earned <strong>+{run.xp}</strong>
          </div>
          {run.xpAwards?.map((award, index) => (
            <div class="ed-run-modal__xp-detail" key={`${award.source}-${award.label}-${index}`}>
              <span>{award.label}</span>
              <strong>+{award.amount}</strong>
            </div>
          ))}
        </div>
      )}

      {rungViews.length > 0 && (
        <div class="ed-run-modal__rungs">
          <span class="ed-run-modal__rungs-label">Rungs moved</span>
          <div class="ed-run-modal__rungs-list">
            {rungViews.map((view) => (
              <button
                key={view.slug}
                class="ed-run-modal__rung tap-fx"
                aria-label={`${view.name}${view.chip ? `, ${view.chip}` : ''}`}
                onClick={(event) => {
                  rungTriggerRef.current = event.currentTarget
                  openBadge.value = view
                }}
              >
                <BadgeMedallion badge={view} size={44} />
              </button>
            ))}
          </div>
        </div>
      )}

      {openBadge.value && (
        <BadgeSheet
          badge={openBadge.value}
          playerId={player.value?.id}
          playerName={player.value ? player.value.publicName || PUBLIC_NAME_FALLBACK : undefined}
          onClose={() => (openBadge.value = null)}
          returnFocus={rungTriggerRef.current}
        />
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
          {run.mode !== 'practice' && (
            <ShareLine
              mode={run.mode}
              score={scoreLabel(run.mode, run.score)}
              runId={run.runId}
              completedAt={run.completedAt}
              compact
            />
          )}
        </div>
      )}
    </DetailModal>
  )
}
