import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { GAME_MODES, type GameMode, type Season } from '@elixir-drop/contracts'
import PlayerAvatar from '../components/PlayerAvatar'
import { getLeaderboard, type LeaderboardEntry } from '../lib/api'

const LABELS: Record<GameMode, string> = {
  surge: 'Surge',
  practice: 'Practice',
  identify: 'Identify',
  'higher-lower': 'Higher / Lower',
  trade: 'Trade',
  ladder: 'Speed Ladder',
  'endless-ladder': 'Endless Ladder',
  'cost-sweep': 'Cost Sweep',
  blitz: 'Blitz',
  survival: 'Survival'
}

const TIME_MODES = new Set<GameMode>(['surge', 'identify', 'trade', 'ladder'])

function scoreLabel(mode: GameMode, score: number): string {
  if (TIME_MODES.has(mode)) return `${(score / 1_000).toFixed(2)}s`
  if (mode === 'practice') return `${score}%`
  return String(score)
}

function warPhaseLabel(periodType: Season['periodType']): string | undefined {
  if (periodType === 'training') return 'Training days'
  if (periodType === 'warDay') return 'Battle days'
  if (periodType === 'colosseum') return 'Colosseum'
  return undefined
}

function daysLeftLabel(days: number | undefined): string | undefined {
  if (days === undefined) return undefined
  if (days <= 0) return 'week ending soon'
  return `${days} ${days === 1 ? 'day' : 'days'} left in week`
}

export default function Leaderboards() {
  const mode = useSignal<GameMode>('surge')
  const entries = useSignal<LeaderboardEntry[]>([])
  const season = useSignal<Season | null>(null)
  const loading = useSignal(true)
  const error = useSignal('')

  useEffect(() => {
    loading.value = true
    error.value = ''
    void getLeaderboard(mode.value)
      .then((response) => {
        entries.value = response.entries
        season.value = response.currentSeason
      })
      .catch((reason: unknown) => {
        error.value = reason instanceof Error ? reason.message : 'Leaderboard could not be loaded.'
      })
      .finally(() => (loading.value = false))
  }, [mode.value, entries, error, loading, season])

  return (
    <div class="main-content leaderboard-screen">
      <div class="leaderboard-head">
        <div class="eyebrow">Clan Wars season</div>
        <h1>Drop leaderboards</h1>
        {season.value && (
          <p class="lede">
            {season.value.crSeasonId !== undefined && season.value.currentWeek !== undefined ? (
              <>
                CR Season {season.value.crSeasonId} · Week {season.value.currentWeek}
                {warPhaseLabel(season.value.periodType) ? ` · ${warPhaseLabel(season.value.periodType)}` : ''}
                {daysLeftLabel(season.value.daysRemainingInWeek)
                  ? ` · ${daysLeftLabel(season.value.daysRemainingInWeek)}`
                  : ''}
                <br />
              </>
            ) : (
              <>{season.value.durationWeeks}-week season · </>
            )}
            Leaderboard resets{' '}
            {new Date(season.value.endsAt).toLocaleDateString(undefined, {
              timeZone: 'UTC',
              month: 'short',
              day: 'numeric'
            })}{' '}
            at 10:00 UTC
          </p>
        )}
      </div>
      <label class="leaderboard-picker">
        Game
        <select value={mode.value} onChange={(event) => (mode.value = event.currentTarget.value as GameMode)}>
          {GAME_MODES.map((value) => (
            <option key={value} value={value}>
              {LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {loading.value && <div class="account-message">Loading leaderboard…</div>}
      {error.value && <div class="account-message account-message--error">{error.value}</div>}
      {!loading.value && !error.value && (
        <ol class="leaderboard-list">
          {entries.value.map((entry) => (
            <li class="leaderboard-row" key={entry.player.id}>
              <span class="leaderboard-rank">#{entry.rank}</span>
              <PlayerAvatar favoriteCardId={entry.player.favoriteCardId} size="medium" />
              <span class="leaderboard-player">
                <strong>{entry.player.publicName}</strong>
                <small>
                  Level {entry.player.level}
                  {entry.player.playerTag ? ` · ${entry.player.playerTag}` : ''}
                </small>
              </span>
              <span class="leaderboard-score">{scoreLabel(mode.value, entry.score)}</span>
            </li>
          ))}
          {!entries.value.length && <li class="leaderboard-empty">No scores yet. First run gets the crown.</li>}
        </ol>
      )}
    </div>
  )
}
