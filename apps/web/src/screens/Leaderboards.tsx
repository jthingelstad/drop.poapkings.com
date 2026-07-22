import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { GameMode, Season } from '@elixir-drop/contracts'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import { player } from '../lib/account'
import { ApiError, getLeaderboard, type LeaderboardEntry, type LeaderboardScope } from '../lib/api'
import { GAME_BY_MODE, RANKED_GAMES, scoreLabel } from '../lib/game-metadata'
import { navigate } from '../lib/router'

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
    <li
      class={`ed-lbrow leaderboard-row${entry.rank <= 3 ? ' leaderboard-row--podium' : ''}${
        isPlayer ? ' ed-lbrow--you leaderboard-row--player' : ''
      }`}
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
        {entry.timeMs !== undefined && <small class="ed-lbrow__time">{(entry.timeMs / 1000).toFixed(2)}s</small>}
      </span>
    </li>
  )
}

const SCOPES: Array<{ scope: LeaderboardScope; label: string }> = [
  { scope: 'season', label: 'Season' },
  { scope: 'all-time', label: 'All-time' }
]

export default function Leaderboards() {
  const mode = useSignal<GameMode>('surge')
  const scope = useSignal<LeaderboardScope>('season')
  const entries = useSignal<LeaderboardEntry[]>([])
  const season = useSignal<Season | null>(null)
  const loading = useSignal(true)
  const error = useSignal('')

  useEffect(() => {
    const controller = new AbortController()
    loading.value = true
    error.value = ''
    void getLeaderboard(mode.value, scope.value, controller.signal)
      .then((response) => {
        entries.value = response.entries
        season.value = response.currentSeason
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.code === 'request_cancelled') return
        error.value = reason instanceof Error ? reason.message : 'Leaderboard could not be loaded.'
      })
      .finally(() => {
        if (!controller.signal.aborted) loading.value = false
      })
    return () => controller.abort()
  }, [mode.value, scope.value, entries, error, loading, season])

  const isAllTime = scope.value === 'all-time'
  const selectedGame = GAME_BY_MODE.get(mode.value)!

  return (
    <div class="ed-board leaderboard-screen">
      <header class="ed-board__head">
        <div class="ed-eyebrow">Every run counts</div>
        {isAllTime ? (
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

      <div class="ed-board__modes row-x" aria-label="Choose a game leaderboard">
        {RANKED_GAMES.map((game) => (
          <button
            aria-pressed={mode.value === game.mode}
            class={`ed-modetab${mode.value === game.mode ? ' ed-modetab--active' : ''}`}
            onClick={() => (mode.value = game.mode)}
            key={game.mode}
          >
            <span aria-hidden="true">{game.icon}</span> {game.name}
          </button>
        ))}
      </div>

      <section class="ed-board__list leaderboard-list" aria-labelledby="active-leaderboard-title">
        <h2 id="active-leaderboard-title" class="sr-only">
          {selectedGame.name} leaderboard
        </h2>
        {loading.value && <div class="ed-rail-empty">Loading leaderboard…</div>}
        {error.value && <div class="ed-board__error">{error.value}</div>}
        {!loading.value && !error.value && (
          <ol class="ed-board__rows">
            {entries.value.map((entry) => (
              <LeaderboardRow entry={entry} mode={mode.value} key={entry.player.id} />
            ))}
            {!entries.value.length && (
              <li class="ed-board__empty">
                <strong>No scores yet.</strong>
                <span>First run gets the crown.</span>
                <button class="ed-textlink" onClick={() => navigate(selectedGame.path)}>
                  Play {selectedGame.name} <Icon name="arrow-right" />
                </button>
              </li>
            )}
          </ol>
        )}
      </section>
    </div>
  )
}
