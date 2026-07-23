import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import ArenaProgress from '../components/ArenaProgress'
import PlayerAvatar from '../components/PlayerAvatar'
import { rankFor } from '../data/starRanks'
import { ApiError, getPublicPlayer, type PublicPlayer as PublicPlayerData, type RecentRun } from '../lib/api'
import { challengeCard } from '../lib/challenge-cards'
import { gameDisplay, scoreLabel } from '../lib/game-metadata'
import { playerIdFromRoute, publicPlayerPreview } from '../lib/public-player'
import { back, navigate, route } from '../lib/router'

export default function PublicProfile() {
  const playerId = playerIdFromRoute(route.value)
  const cached = publicPlayerPreview.value?.id === playerId ? publicPlayerPreview.value : null
  const viewedPlayer = useSignal<PublicPlayerData | typeof cached>(cached)
  const runs = useSignal<RecentRun[]>([])
  const loading = useSignal(true)
  const error = useSignal('')

  useEffect(() => {
    const controller = new AbortController()
    const preview = publicPlayerPreview.value?.id === playerId ? publicPlayerPreview.value : null
    viewedPlayer.value = preview
    runs.value = []
    error.value = ''
    loading.value = true
    if (!playerId) {
      loading.value = false
      error.value = 'This player link is invalid.'
      return () => controller.abort()
    }
    void getPublicPlayer(playerId, controller.signal)
      .then((response) => {
        viewedPlayer.value = response.player
        publicPlayerPreview.value = response.player
        runs.value = response.recentRuns
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.code === 'request_cancelled') return
        error.value =
          reason instanceof ApiError && reason.code === 'player_not_found'
            ? 'This player profile is no longer available.'
            : 'This player profile could not be refreshed.'
      })
      .finally(() => {
        if (!controller.signal.aborted) loading.value = false
      })
    return () => controller.abort()
  }, [playerId, viewedPlayer, runs, loading, error])

  const current = viewedPlayer.value
  if (!current) {
    return (
      <div class="ed-profile ed-public-profile">
        <button class="ed-textlink ed-public-profile__back" onClick={() => back('/leaderboards')}>
          ← Back to leaderboards
        </button>
        <div class="ed-public-profile__state" role={error.value ? 'alert' : 'status'}>
          {loading.value ? 'Loading player profile…' : error.value}
        </div>
      </div>
    )
  }

  const favorite = current.favoriteCardId ? challengeCard(current.favoriteCardId) : undefined
  const arena = rankFor(current.xp).current

  return (
    <div class="ed-profile ed-public-profile">
      <button class="ed-textlink ed-public-profile__back" onClick={() => back('/leaderboards')}>
        ← Back to leaderboards
      </button>

      <div class="ed-profile__banner">
        <div class="ed-profile__banner-bg" style={{ backgroundImage: `url('${arena.image}')` }} aria-hidden="true" />
        <div class="ed-profile__banner-row">
          <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
          <div class="ed-profile__ident">
            <h1 class="ed-profile__name">{current.publicName}</h1>
            <div class="ed-profile__card">{favorite ? `${favorite.name} · Player Card` : 'Drop Player'}</div>
            {current.playerTag && <div class="ed-profile__email">Clash Royale {current.playerTag}</div>}
          </div>
        </div>
      </div>

      <div class="ed-profile__stats profile-xp">
        <div class="ed-profile__stat-row">
          <div class="ed-profile__stat">
            <div class="ed-profile__stat-val ed-profile__stat-val--gold">{current.xp.toLocaleString()}</div>
            <div class="ed-profile__stat-label">Player XP</div>
          </div>
          <div class="ed-profile__stat">
            <div class="ed-profile__stat-val">{current.totalGames.toLocaleString()}</div>
            <div class="ed-profile__stat-label">lifetime games</div>
          </div>
        </div>
        <ArenaProgress xp={current.xp} />
      </div>

      <section class="ed-profile__recent">
        <div class="ed-profile__recent-head">
          <span class="ed-profile__recent-title">Recent games</span>
          <button class="ed-textlink" onClick={() => navigate('/leaderboards')}>
            Leaderboards →
          </button>
        </div>
        {runs.value.length ? (
          <ul class="ed-profile__recent-list">
            {runs.value.slice(0, 5).map((run) => {
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
          <p class="ed-profile__recent-empty">
            {loading.value
              ? 'Loading recent games…'
              : error.value
                ? 'Recent games are temporarily unavailable.'
                : 'No recent ranked games to show.'}
          </p>
        )}
      </section>
    </div>
  )
}
