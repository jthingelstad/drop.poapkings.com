import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { GameMode, Season } from '@elixir-drop/contracts'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import { player } from '../lib/account'
import { ApiError, getLeaderboard, type LeaderboardEntry } from '../lib/api'
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
  return (
    <li
      class={`leaderboard-row${entry.rank <= 3 ? ' leaderboard-row--podium' : ''}${
        isPlayer ? ' leaderboard-row--player' : ''
      }`}
    >
      <span class="leaderboard-rank">{entry.rank}</span>
      <PlayerAvatar favoriteCardId={entry.player.favoriteCardId} size="medium" />
      <span class="leaderboard-player">
        <strong>
          {entry.player.publicName}
          {isPlayer && <em>You</em>}
        </strong>
        <small class="leaderboard-stats">
          <span class="leaderboard-stat leaderboard-stat--xp">
            <Icon name="zap" />
            {entry.player.xp.toLocaleString()} XP
          </span>
          <span class="leaderboard-stat">
            {games.toLocaleString()} {games === 1 ? 'game' : 'games'}
          </span>
        </small>
      </span>
      <span class="leaderboard-score">
        {scoreLabel(mode, entry.score)}
        {entry.timeMs !== undefined && (
          <small class="leaderboard-score__time">{(entry.timeMs / 1000).toFixed(1)}s</small>
        )}
      </span>
    </li>
  )
}

export default function Leaderboards() {
  const mode = useSignal<GameMode>('surge')
  const entries = useSignal<LeaderboardEntry[]>([])
  const season = useSignal<Season | null>(null)
  const loading = useSignal(true)
  const error = useSignal('')

  useEffect(() => {
    const controller = new AbortController()
    loading.value = true
    error.value = ''
    void getLeaderboard(mode.value, controller.signal)
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
  }, [mode.value, entries, error, loading, season])

  const selectedGame = GAME_BY_MODE.get(mode.value)!

  return (
    <div class="main-content leaderboard-screen leaderboard-screen--competition">
      <div class="leaderboard-hero">
        <div>
          <div class="eyebrow">Every run counts</div>
          <h1>{season.value ? seasonHeading(season.value) : 'Season leaderboards'}</h1>
          {season.value ? (
            <p>{seasonTiming(season.value)}</p>
          ) : (
            <p>Climb a fresh set of boards every Clash Royale season.</p>
          )}
        </div>
        <button class="btn btn--gold" onClick={() => navigate(selectedGame.path)}>
          Play {selectedGame.name}
        </button>
      </div>

      <div class="leaderboard-mode-tabs" aria-label="Choose a game leaderboard">
        {RANKED_GAMES.map((game) => (
          <button
            aria-pressed={mode.value === game.mode}
            class={mode.value === game.mode ? 'leaderboard-mode leaderboard-mode--active' : 'leaderboard-mode'}
            onClick={() => (mode.value = game.mode)}
            key={game.mode}
          >
            <span aria-hidden="true">{game.icon}</span>
            {game.name}
          </button>
        ))}
      </div>

      <section class="leaderboard-board" aria-labelledby="active-leaderboard-title">
        <div class="leaderboard-board__head">
          <div>
            <span aria-hidden="true">{selectedGame.icon}</span>
            <h2 id="active-leaderboard-title">{selectedGame.name}</h2>
          </div>
          <span>{entries.value.length ? `Top ${entries.value.length}` : 'The crown is open'}</span>
        </div>
        {loading.value && <div class="competition-empty">Loading leaderboard…</div>}
        {error.value && <div class="account-message account-message--error">{error.value}</div>}
        {!loading.value && !error.value && (
          <ol class="leaderboard-list">
            {entries.value.map((entry) => (
              <LeaderboardRow entry={entry} mode={mode.value} key={entry.player.id} />
            ))}
            {!entries.value.length && (
              <li class="leaderboard-empty">
                <strong>No scores yet.</strong>
                <span>First run gets the crown.</span>
                <button class="text-action" onClick={() => navigate(selectedGame.path)}>
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
