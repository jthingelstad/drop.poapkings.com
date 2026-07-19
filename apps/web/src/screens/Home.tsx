import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import rawCards from '@elixir-drop/game-data/cards.json'
import type { GameMode, Season, SiteStats } from '@elixir-drop/contracts'
import Icon from '../components/Icon'
import PlayerAvatar from '../components/PlayerAvatar'
import { accountStatus, initializeAccount, player, recentRuns } from '../lib/account'
import { getLeaderboard, getStats, type LeaderboardEntry } from '../lib/api'
import {
  bestScoresFromRuns,
  betterScore,
  GAME_BY_MODE,
  gameDisplay,
  GAMES,
  scoreFromRecords,
  scoreLabel,
  type GameInfo
} from '../lib/game-metadata'
import { navigate } from '../lib/router'
import { getRecords, getSeasonRecords } from '../lib/storage'
import { registerLogoTap } from '../lib/screensaver'
import type { CardsData, Records } from '../types'

const CARD_COUNT = (rawCards as CardsData).cards.length

function seasonLine(season: Season | null): string {
  if (!season) return 'Season standings update with the Clash Royale war clock'
  const pieces = [
    season.crSeasonId === undefined ? 'Current season' : `CR Season ${season.crSeasonId}`,
    season.currentWeek === undefined ? undefined : `Week ${season.currentWeek}`,
    season.periodType === 'training'
      ? 'Training days'
      : season.periodType === 'warDay'
        ? 'Battle days'
        : season.periodType === 'colosseum'
          ? 'Colosseum'
          : undefined,
    season.daysRemainingInWeek === undefined
      ? undefined
      : season.daysRemainingInWeek <= 0
        ? 'Week ending soon'
        : `${season.daysRemainingInWeek} ${season.daysRemainingInWeek === 1 ? 'day' : 'days'} left`
  ]
  return pieces.filter(Boolean).join(' · ')
}

function activityAge(completedAt: string): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(completedAt).getTime()) / 60_000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  const hours = Math.round(elapsedMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function mergedBestScores(season: Season | null): Partial<Record<GameMode, number>> {
  const stored: Records = season ? getSeasonRecords(season.id) : getRecords()
  const recent = bestScoresFromRuns(recentRuns.value, season?.id)
  const merged: Partial<Record<GameMode, number>> = {}
  for (const game of GAMES) {
    const storedScore = scoreFromRecords(game.mode, stored)
    const recentScore = recent[game.mode]
    if (storedScore !== undefined) merged[game.mode] = storedScore
    if (recentScore !== undefined && betterScore(game.mode, recentScore, merged[game.mode]))
      merged[game.mode] = recentScore
  }
  return merged
}

function GameCard({ game, best }: { game: GameInfo; best: number | undefined }) {
  return (
    <button
      class={`competition-game${game.mode === 'surge' ? ' competition-game--featured' : ''}`}
      onClick={() => navigate(game.path)}
    >
      <span class="competition-game__icon" aria-hidden="true">
        {game.icon}
      </span>
      <span class="competition-game__copy">
        <strong>{game.name}</strong>
        <small>{game.description}</small>
      </span>
      <span class="competition-game__best">
        <small>{best === undefined ? 'Set a score' : 'Season best'}</small>
        {best !== undefined && <strong>{scoreLabel(game.mode, best)}</strong>}
      </span>
      <Icon name="arrow-right" />
    </button>
  )
}

function StandingRow({ entry }: { entry: LeaderboardEntry }) {
  const isPlayer = player.value?.id === entry.player.id
  return (
    <li class={`season-standing${isPlayer ? ' season-standing--player' : ''}`}>
      <span class="season-standing__rank">{entry.rank}</span>
      <PlayerAvatar favoriteCardId={entry.player.favoriteCardId} size="medium" />
      <span class="season-standing__player">
        <strong>{entry.player.publicName}</strong>
        <small>{isPlayer ? 'You' : `Level ${entry.player.level}`}</small>
      </span>
      <strong class="season-standing__score">{scoreLabel('surge', entry.score)}</strong>
    </li>
  )
}

function Standings({ entries, loading }: { entries: LeaderboardEntry[]; loading: boolean }) {
  const topEntries = entries.slice(0, 3)
  const playerEntry = player.value ? entries.find((entry) => entry.player.id === player.value?.id) : undefined
  const rows = playerEntry && playerEntry.rank > 3 ? [...topEntries, playerEntry] : topEntries
  return (
    <section class="season-board" aria-labelledby="season-standings-title">
      <div class="competition-panel__head">
        <h2 id="season-standings-title">Season standings: Surge</h2>
        <button class="text-action" onClick={() => navigate('/leaderboards')}>
          All leaderboards <Icon name="arrow-right" />
        </button>
      </div>
      {loading && <div class="competition-empty">Loading the board…</div>}
      {!loading && !rows.length && <div class="competition-empty">No scores yet. First run gets the crown.</div>}
      {!!rows.length && (
        <ol class="season-standings">
          {rows.map((entry) => (
            <StandingRow entry={entry} key={`${entry.rank}-${entry.player.id}`} />
          ))}
        </ol>
      )}
    </section>
  )
}

function PlayerSeason({ bestScores }: { bestScores: Partial<Record<GameMode, number>> }) {
  if (accountStatus.value === 'unavailable') {
    return (
      <section class="competition-panel competition-panel--join">
        <h2>Player services reconnecting</h2>
        <p>Your profile and recent games will return here when Drop reconnects.</p>
        <button class="btn btn--secondary" onClick={() => void initializeAccount()}>
          Try again
        </button>
      </section>
    )
  }
  if (accountStatus.value !== 'authenticated' || !player.value) {
    return (
      <section class="competition-panel competition-panel--join">
        <h2>Make the season yours</h2>
        <p>Sign in to record every run, build your player level, and chase a place on each board.</p>
        <button class="btn btn--gold" onClick={() => navigate('/login')}>
          Sign in to compete
        </button>
      </section>
    )
  }
  const featuredModes: GameMode[] = ['surge', 'trade', 'survival']
  return (
    <section class="competition-panel player-season" aria-labelledby="your-season-title">
      <div class="competition-panel__head">
        <h2 id="your-season-title">Your season</h2>
        <button class="text-action" onClick={() => navigate('/profile')}>
          Profile <Icon name="arrow-right" />
        </button>
      </div>
      <div class="player-season__identity">
        <PlayerAvatar favoriteCardId={player.value.favoriteCardId} size="large" />
        <div>
          <strong>{player.value.publicName}</strong>
          <span>Level {player.value.level}</span>
          <small>{player.value.totalGames} lifetime games</small>
        </div>
      </div>
      <dl class="player-bests">
        {featuredModes.map((mode) => (
          <div key={mode}>
            <dt>
              <span aria-hidden="true">{GAME_BY_MODE.get(mode)?.icon}</span> {GAME_BY_MODE.get(mode)?.name}
            </dt>
            <dd>{bestScores[mode] === undefined ? '—' : scoreLabel(mode, bestScores[mode]!)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function RecentActivity() {
  const runs = recentRuns.value.slice(0, 3)
  return (
    <section class="competition-panel recent-activity" aria-labelledby="recent-activity-title">
      <div class="competition-panel__head">
        <h2 id="recent-activity-title">Recent activity</h2>
      </div>
      {!runs.length && (
        <div class="competition-empty">
          {accountStatus.value === 'authenticated'
            ? 'Your next completed game will show here.'
            : 'Sign in to build a game history.'}
        </div>
      )}
      {!!runs.length && (
        <ul class="activity-list">
          {runs.map((run) => {
            // Vaulted modes still render for historical runs.
            const game = gameDisplay(run.mode)
            return (
              <li key={run.runId}>
                <span class="activity-list__icon" aria-hidden="true">
                  {game.icon}
                </span>
                <span class="activity-list__game">
                  <strong>{game.name}</strong>
                  <small>{activityAge(run.completedAt)}</small>
                </span>
                <strong>{scoreLabel(run.mode, run.score)}</strong>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function Home() {
  const stats = useSignal<SiteStats | null>(null)
  const standings = useSignal<LeaderboardEntry[]>([])
  const standingsLoading = useSignal(true)

  useEffect(() => {
    const controller = new AbortController()
    void getStats(controller.signal)
      .then((value) => (stats.value = value))
      .catch(() => undefined)
    void getLeaderboard('surge', controller.signal)
      .then((value) => (standings.value = value.entries))
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) standingsLoading.value = false
      })
    return () => controller.abort()
  }, [standings, standingsLoading, stats])

  const bestScores = mergedBestScores(stats.value?.currentSeason ?? null)

  return (
    <div class="home home--competition">
      <div class="competition-hero">
        <div class="competition-hero__identity">
          <h1 class="hero__title" onClick={() => registerLogoTap()}>
            <span class="t-elixir">ELIXIR</span>
            <span class="t-drop">DROP</span>
          </h1>
          <p>Train your Clash Royale elixir instinct.</p>
          <button class="btn btn--gold btn--lg" onClick={() => navigate('/surge')}>
            ▶ Play Surge
          </button>
          <div class="season-clock">{seasonLine(stats.value?.currentSeason ?? null)}</div>
        </div>
        <Standings entries={standings.value} loading={standingsLoading.value} />
      </div>

      <div class="home__wrap competition-home__body">
        <div class="competition-rail">
          <PlayerSeason bestScores={bestScores} />
          <RecentActivity />
          <section class="competition-panel community-progress">
            <img src="/assets/elixir-hype.png" alt="" aria-hidden="true" />
            <div>
              <h2>Drop together</h2>
              <strong>{stats.value ? stats.value.trophyRoadGames.toLocaleString() : '—'}</strong>
              <span>games on Trophy Road</span>
              <small>
                {CARD_COUNT} cards · {GAMES.length} ways to play
              </small>
            </div>
          </section>
        </div>

        <section class="game-catalog" id="games" aria-labelledby="game-catalog-title">
          <div class="competition-section-head">
            <h2 id="game-catalog-title">Choose your game</h2>
            <span>Play. Beat your best. Climb the boards.</span>
          </div>
          <div class="competition-games">
            {GAMES.map((game) => (
              <GameCard game={game} best={bestScores[game.mode]} key={game.mode} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
