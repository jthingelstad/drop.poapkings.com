import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { playerReference, runReference } from '@elixir-drop/contracts'
import ArenaProgress from '../components/ArenaProgress'
import BadgeGrid from '../components/BadgeGrid'
import Icon from '../components/Icon'
import PlayerAvatar from '../components/PlayerAvatar'
import { ApiError, getPublicPlayer, type PublicPlayer as PublicPlayerData, type RecentRun } from '../lib/api'
import { challengeCard } from '../lib/challenge-cards'
import ModeIcon from '../components/ModeIcon'
import { gameDisplay, scoreLabel } from '../lib/game-metadata'
import { playerIdFromRoute, publicPlayerPreview } from '../lib/public-player'
import { royaleApiClanUrl, royaleApiPlayerUrl } from '../lib/royale-api'
import { back, navigate, route } from '../lib/router'
import { badgeViews, earnedCount, type BadgeState } from '../lib/badges'
import AccountTags from '../components/AccountTags'

export default function PublicProfile() {
  const playerId = playerIdFromRoute(route.value)
  const cached = publicPlayerPreview.value?.id === playerId ? publicPlayerPreview.value : null
  const viewedPlayer = useSignal<PublicPlayerData | typeof cached>(cached)
  const runs = useSignal<RecentRun[]>([])
  const publicBadges = useSignal<BadgeState[]>([])
  const loading = useSignal(true)
  const error = useSignal('')

  useEffect(() => {
    const controller = new AbortController()
    const preview = publicPlayerPreview.value?.id === playerId ? publicPlayerPreview.value : null
    viewedPlayer.value = preview
    runs.value = []
    publicBadges.value = []
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
        publicBadges.value = response.badges?.badges ?? []
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
  }, [playerId, viewedPlayer, runs, publicBadges, loading, error])

  const current = viewedPlayer.value
  if (!current) {
    return (
      <div class="ed-profile ed-public-profile">
        <h1 class="sr-only">Player profile</h1>
        <button class="ed-textlink ed-public-profile__back" onClick={() => back('/leaderboards')}>
          <Icon name="arrow-left" /> Back to leaderboards
        </button>
        <div class="ed-public-profile__state" role={error.value ? 'alert' : 'status'}>
          {loading.value ? 'Loading player profile…' : error.value}
        </div>
      </div>
    )
  }

  const favorite = current.favoriteCardId ? challengeCard(current.favoriteCardId) : undefined
  const badgeCount = earnedCount(badgeViews(publicBadges.value))
  const clashRoyale = 'clashRoyale' in current ? current.clashRoyale : undefined

  return (
    <div class="ed-profile ed-public-profile">
      <button class="ed-textlink ed-public-profile__back" onClick={() => back('/leaderboards')}>
        <Icon name="arrow-left" /> Back to leaderboards
      </button>

      <div class="ed-profile__banner">
        <div class="ed-profile__banner-row">
          <PlayerAvatar favoriteCardId={current.favoriteCardId} size="large" />
          <div class="ed-profile__ident">
            <h1 class="ed-profile__name">
              <span>{current.publicName}</span>
              <AccountTags tags={current.accountTags} />
            </h1>
            <div class="ed-profile__card">{favorite ? `${favorite.name} · Player Card` : 'Drop Player'}</div>
            <div class="ed-profile__reference" aria-label={`Player tag ${playerReference(current.id)}`}>
              Player {playerReference(current.id)}
            </div>
            {current.playerTag && (
              <div class="ed-profile__clash" aria-label="Clash Royale identity">
                {clashRoyale?.name && <div class="ed-profile__clash-name">{clashRoyale.name}</div>}
                <a
                  class="ed-profile__clash-link"
                  href={royaleApiPlayerUrl(current.playerTag)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${clashRoyale?.name ?? current.playerTag} on RoyaleAPI`}
                >
                  Clash Royale {current.playerTag} <Icon name="external-link" />
                </a>
                {clashRoyale?.clan && (
                  <a
                    class="ed-profile__clash-link ed-profile__clash-link--clan"
                    href={royaleApiClanUrl(clashRoyale.clan.tag)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View clan ${clashRoyale.clan.name} on RoyaleAPI`}
                  >
                    Clan {clashRoyale.clan.name} · {clashRoyale.clan.tag} <Icon name="external-link" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <section class="ed-profile__recent ed-profile__badges ed-profile__badges--featured">
        <div class="ed-profile__recent-head">
          <span class="ed-profile__recent-title">Badges</span>
          {badgeCount > 0 && <span class="ed-profile__recent-score">{badgeCount} earned</span>}
        </div>
        <BadgeGrid states={publicBadges.value} earnedOnly playerId={current.id} playerName={current.publicName} />
      </section>

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
            Leaderboards <Icon name="arrow-right" />
          </button>
        </div>
        {runs.value.length ? (
          <ul class="ed-profile__recent-list">
            {runs.value.slice(0, 5).map((run) => {
              const game = gameDisplay(run.mode)
              return (
                <li key={run.runId}>
                  <span class="ed-profile__recent-name">
                    <ModeIcon mode={run.mode} size={24} /> {game.name}
                  </span>
                  <span class="ed-profile__recent-score">{scoreLabel(run.mode, run.score)}</span>
                  <time dateTime={run.completedAt}>
                    {new Date(run.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </time>
                  <div class="ed-review-details">
                    <small class="ed-review-reference">Run {runReference(run.runId)}</small>
                  </div>
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
