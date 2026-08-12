import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { GameMode, Season } from '@elixir-drop/contracts'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import { accountStatus, player, refreshAccount, sessionToken } from '../lib/account'
import { ApiError, getLeaderboard, type LeaderboardEntry, type LeaderboardScope } from '../lib/api'
import { formatSeconds } from '../lib/format'
import { GAME_BY_MODE, RANKED_GAMES, scoreLabel } from '../lib/game-metadata'
import EmptyState from '../components/EmptyState'
import ModeIcon from '../components/ModeIcon'
import { navigate } from '../lib/router'
import { playerProfilePath } from '../lib/public-player'
import ReviewStatusMark from '../components/ReviewStatus'

// The leaderboards are season-scoped, not week-scoped: drop the Clan-Wars
// weekly clock entirely and speak only to the season boundary.
function seasonHeading(season: Season): string {
  return season.crSeasonId === undefined ? 'Season leaderboards' : `Season ${season.crSeasonId} leaderboards`
}

function seasonTiming(season: Season): string {
  const date = new Date(season.endsAt).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric'
  })
  const time = new Date(season.endsAt).toLocaleTimeString(undefined, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const estimated = season.source === 'calendar-fallback' ? ' (estimated)' : ''
  return `Season ends ${date} at ${time} UTC${estimated} — new boards open then`
}

function LeaderboardRow({ entry, mode }: { entry: LeaderboardEntry; mode: GameMode }) {
  const isPlayer = entry.player.id === player.value?.id
  const games = entry.player.totalGames
  const rankColor = entry.rank === 1 ? 'gold' : entry.rank <= 3 ? 'lav' : 'muted'
  return (
    <li class={`ed-lbrow${entry.rank <= 3 ? ' ed-lbrow--podium' : ''}${isPlayer ? ' ed-lbrow--you' : ''}`}>
      <button
        class="ed-lbrow__button"
        aria-label={`View ${isPlayer ? 'your' : `${entry.player.publicName}'s`} profile`}
        onClick={() => navigate(playerProfilePath(entry.player, player.value?.id))}
      >
        <span class={`ed-lbrow__rank ed-lbrow__rank--${rankColor}`}>{entry.rank}</span>
        <PlayerAvatar favoriteCardId={entry.player.favoriteCardId} size="medium" />
        <span class="ed-lbrow__player">
          <strong class="ed-lbrow__name">
            {entry.player.publicName}
            {isPlayer && <em> You</em>}
          </strong>
          <small class="ed-lbrow__meta">
            <span class="ed-lbrow__xp">
              <Icon name="zap" />
              {entry.player.xp.toLocaleString()} XP
            </span>
            <span>
              · {games.toLocaleString()} {games === 1 ? 'game' : 'games'}
            </span>
          </small>
        </span>
        <span class="ed-lbrow__score">
          {scoreLabel(mode, entry.score)}
          {entry.refereeReviewed && <ReviewStatusMark status="reviewed" />}
          {entry.timeMs !== undefined && <small class="ed-lbrow__time">{formatSeconds(entry.timeMs)}s</small>}
        </span>
      </button>
    </li>
  )
}

const SCOPES: Array<{ scope: LeaderboardScope; label: string }> = [
  { scope: 'season', label: 'Season' },
  { scope: 'all-time', label: 'All-time' },
  { scope: 'clan', label: 'Clan' }
]

type ClanGate = 'signed-out' | 'tag-required' | 'profile-pending' | 'profile-missing' | 'no-clan' | null

export default function Leaderboards() {
  const mode = useSignal<GameMode>('surge')
  const scope = useSignal<LeaderboardScope>('season')
  const entries = useSignal<LeaderboardEntry[]>([])
  const season = useSignal<Season | null>(null)
  const activeClan = useSignal<{ tag: string; name: string } | null>(null)
  const clanGate = useSignal<ClanGate>(null)
  const loading = useSignal(true)
  const error = useSignal('')

  const currentPlayer = player.value
  const currentAccountStatus = accountStatus.value
  const currentClan = currentPlayer?.clashRoyale?.clan
  const crStatus = currentPlayer?.clashRoyale?.status

  useEffect(() => {
    const controller = new AbortController()
    entries.value = []
    activeClan.value = null
    clanGate.value = null
    loading.value = true
    error.value = ''

    if (scope.value === 'clan') {
      if (currentAccountStatus === 'loading') return () => controller.abort()
      if (currentAccountStatus !== 'authenticated' || !currentPlayer) {
        clanGate.value = 'signed-out'
        loading.value = false
        return () => controller.abort()
      }
      if (!currentPlayer.playerTag) {
        clanGate.value = 'tag-required'
        loading.value = false
        return () => controller.abort()
      }
      if (!currentClan) {
        clanGate.value =
          crStatus === 'pending' ? 'profile-pending' : crStatus === 'not_found' ? 'profile-missing' : 'no-clan'
        loading.value = false
        return () => controller.abort()
      }
    }

    const request =
      scope.value === 'clan'
        ? getLeaderboard(mode.value, scope.value, controller.signal, sessionToken())
        : getLeaderboard(mode.value, scope.value, controller.signal)
    void request
      .then((response) => {
        entries.value = response.entries
        season.value = response.currentSeason
        activeClan.value = response.clan ?? null
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.code === 'request_cancelled') return
        error.value = reason instanceof Error ? reason.message : 'Leaderboard could not be loaded.'
      })
      .finally(() => {
        if (!controller.signal.aborted) loading.value = false
      })
    return () => controller.abort()
  }, [
    mode.value,
    scope.value,
    currentAccountStatus,
    currentPlayer,
    currentClan,
    crStatus,
    entries,
    activeClan,
    clanGate,
    error,
    loading,
    season
  ])

  useEffect(() => {
    if (scope.value !== 'clan' || !currentPlayer?.playerTag || currentClan || crStatus !== 'pending') return
    const interval = window.setInterval(() => void refreshAccount().catch(() => undefined), 2_000)
    return () => window.clearInterval(interval)
  }, [scope.value, currentPlayer?.playerTag, currentClan, crStatus])

  const isAllTime = scope.value === 'all-time'
  const isClan = scope.value === 'clan'
  const selectedGame = GAME_BY_MODE.get(mode.value)!

  const clanEmptyState = (() => {
    if (clanGate.value === 'signed-out')
      return {
        heading: 'Sign in for clan rankings',
        line: 'Connect your Drop player to see how you rank against clanmates.',
        actionLabel: 'Sign in',
        href: '/login'
      }
    if (clanGate.value === 'tag-required')
      return {
        heading: 'Add your player tag',
        line: 'Drop uses your public Clash Royale profile to find your current clan.',
        actionLabel: 'Add player tag',
        href: '/profile?edit=player-tag'
      }
    if (clanGate.value === 'profile-pending')
      return {
        heading: 'Loading your clan',
        line: 'Your player tag is saved. Drop is fetching its public Clash Royale profile.',
        actionLabel: 'View profile',
        href: '/profile'
      }
    if (clanGate.value === 'profile-missing')
      return {
        heading: 'Player tag not found',
        line: 'Check the tag on your profile, then try Clan rankings again.',
        actionLabel: 'Edit player tag',
        href: '/profile?edit=player-tag'
      }
    return {
      heading: 'No clan connected',
      line: 'Your linked Clash Royale profile is not currently in a clan.',
      actionLabel: 'View profile',
      href: '/profile'
    }
  })()

  return (
    <div class="ed-board leaderboard-screen">
      <header class="ed-board__head">
        <div class="ed-eyebrow">Every run counts</div>
        {isClan ? (
          <>
            <h1 class="ed-h1">{activeClan.value?.name ?? currentClan?.name ?? 'Clan'} rankings</h1>
            <p class="ed-board__timing">
              All-time bests among current clanmates
              {(activeClan.value?.tag ?? currentClan?.tag) ? ` · ${activeClan.value?.tag ?? currentClan?.tag}` : '.'}
            </p>
          </>
        ) : isAllTime ? (
          <>
            <h1 class="ed-h1">All-time leaderboards</h1>
            <p class="ed-board__timing">Your best-ever score in each mode, across every season.</p>
          </>
        ) : (
          <>
            <h1 class="ed-h1">{season.value ? seasonHeading(season.value) : 'Season leaderboards'}</h1>
            <p class="ed-board__timing">
              {season.value ? seasonTiming(season.value) : 'Climb a fresh set of boards every Clash Royale season.'}
            </p>
          </>
        )}
      </header>

      <div class="ed-board__scopes" aria-label="Choose a leaderboard scope">
        {SCOPES.map((option) => (
          <button
            aria-pressed={scope.value === option.scope}
            class={`ed-scope${scope.value === option.scope ? ' ed-scope--active' : ''}`}
            onClick={() => (scope.value = option.scope)}
            key={option.scope}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div class="ed-board__mode-guide" aria-hidden="true">
        Swipe for every mode <Icon name="arrow-right" />
      </div>
      <div class="ed-board__mode-strip">
        <div class="ed-board__modes row-x" aria-label="Choose a game leaderboard">
          {RANKED_GAMES.map((game) => (
            <button
              aria-pressed={mode.value === game.mode}
              class={`ed-modetab${mode.value === game.mode ? ' ed-modetab--active' : ''}`}
              onClick={() => (mode.value = game.mode)}
              key={game.mode}
            >
              <ModeIcon mode={game.mode} size={44} /> {game.name}
            </button>
          ))}
        </div>
      </div>

      <section class="ed-board__list leaderboard-list" aria-labelledby="active-leaderboard-title">
        <h2 id="active-leaderboard-title" class="sr-only">
          {selectedGame.name} leaderboard
        </h2>
        {loading.value && <div class="ed-rail-empty">Loading leaderboard…</div>}
        {error.value && <div class="ed-board__error">{error.value}</div>}
        {!loading.value && !error.value && isClan && clanGate.value && (
          <div class="ed-board__empty">
            <EmptyState art="empty-board" {...clanEmptyState} />
          </div>
        )}
        {!loading.value && !error.value && (!isClan || !clanGate.value) && (
          <ol class="ed-board__rows">
            {entries.value.map((entry) => (
              <LeaderboardRow entry={entry} mode={mode.value} key={entry.player.id} />
            ))}
            {!entries.value.length && (
              <li class="ed-board__empty">
                <EmptyState
                  art="empty-board"
                  heading={isClan ? 'No clanmates have posted' : 'Nobody has posted'}
                  line={
                    isClan
                      ? 'First clan run on this board takes the crown.'
                      : 'First run on this board takes the crown.'
                  }
                  actionLabel={`Play ${selectedGame.name}`}
                  href={selectedGame.path}
                />
              </li>
            )}
          </ol>
        )}
      </section>
    </div>
  )
}
