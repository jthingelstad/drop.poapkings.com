import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { BADGE_LIST, type GameMode, type Season } from '@elixir-drop/contracts'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import ModeIcon from '../components/ModeIcon'
import ScopeRow from '../components/ScopeRow'
import GateCard from '../components/GateCard'
import BadgeGrid from '../components/BadgeGrid'
import XpTimelinePanel from '../components/XpTimeline'
import EmptyState from '../components/EmptyState'
import SkeletonRows from '../components/Skeleton'
import ReviewStatusMark from '../components/ReviewStatus'
import { accountStatus, badges, player, refreshAccount, sessionToken } from '../lib/account'
import { badgeViews, earnedCount } from '../lib/badges'
import {
  ApiError,
  getLeaderboard,
  getXpTimeline,
  type LeaderboardEntry,
  type LeaderboardScope,
  type XpTimeline
} from '../lib/api'
import { formatLeaderboardSeconds } from '../lib/format'
import { GAME_BY_MODE, leaderboardScoreLabel, RANKED_GAMES } from '../lib/game-metadata'
import { navigate, route } from '../lib/router'
import { boardModeFromRoute } from '../lib/game-routes'
import { playerProfilePath } from '../lib/public-player'
import { CLAN_INVITE_URL } from '../lib/links'
import CauseChip from '../components/CauseChip'
import AccountTags from '../components/AccountTags'
import { offline } from '../lib/api-availability'

// The Ladder is one page with four scopes — Boards, Badges, Clan, XP — under a
// fixed header. The <h1>Ladder</h1> is emitted sr-only by App.tsx ROUTE_LABELS,
// so the visible title is decorative; the header's height never changes between
// scopes, which is what kept the rows from jumping.

type UiScope = 'boards' | 'badges' | 'clan' | 'xp'
type ClanGate = 'signed-out' | 'tag-required' | 'profile-pending' | 'profile-missing' | 'no-clan' | null

const MODE_TAB_LABEL: Partial<Record<GameMode, string>> = {
  surge: 'SURGE',
  rain: 'RAIN',
  trade: 'TRADE',
  survival: 'SURVIVE',
  'higher-lower': 'HIGHER'
}

// The one line beside the title is the current season's close on Boards and
// Clan. Badges and XP omit it because permanent progression has no seasonal
// close.
function seasonEndLine(season: Season | null): string {
  if (!season) return '—'
  const date = new Date(season.endsAt).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric'
  })
  const time = new Date(season.endsAt).toLocaleTimeString(undefined, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return `Ends ${date} · ${time} UTC${season.source === 'calendar-fallback' ? ' (est.)' : ''}`
}

function LeaderboardRow({
  entry,
  mode,
  index,
  rankOverride
}: {
  entry: LeaderboardEntry
  mode: GameMode
  index: number
  rankOverride?: number
}) {
  const isPlayer = entry.player.id === player.value?.id
  const rank = rankOverride ?? entry.rank
  const games = entry.player.totalGames
  const rankColor = rank === 1 ? 'gold' : rank <= 3 ? 'lav' : 'muted'
  const score = leaderboardScoreLabel(mode, entry.score)
  const awaiting = entry.reviewStatus === 'pending'
  return (
    <li
      class={`ed-lbrow${rank <= 3 ? ' ed-lbrow--podium' : ''}${isPlayer ? ' ed-lbrow--you' : ''}${rank === 1 ? ' ed-lbrow--crown' : ''}`}
    >
      <button
        class="ed-lbrow__button"
        aria-label={`View ${isPlayer ? 'your' : `${entry.player.publicName}'s`} profile`}
        onClick={() => navigate(playerProfilePath(entry.player, player.value?.id))}
      >
        <span class={`ed-lbrow__rank ed-lbrow__rank--${rankColor}`}>{rank}</span>
        <PlayerAvatar favoriteCardId={entry.player.favoriteCardId} size="medium" />
        <span class="ed-lbrow__player">
          <span class="ed-lbrow__name-line">
            <strong class="ed-lbrow__name">
              {entry.player.publicName}
              {isPlayer && <em> You</em>}
            </strong>
            <AccountTags tags={entry.player.accountTags} />
          </span>
          {awaiting ? (
            <small class="ed-lbrow__meta ed-lbrow__meta--awaiting">Awaiting the referee</small>
          ) : (
            <small class="ed-lbrow__meta">
              <span class="ed-lbrow__xp">
                <Icon name="zap" />
                {entry.player.xp.toLocaleString()} XP
              </span>
              <span>
                · {games.toLocaleString()} {games === 1 ? 'game' : 'games'}
              </span>
            </small>
          )}
        </span>
        <span class="ed-lbrow__result">
          {entry.reviewStatus ? (
            <ReviewStatusMark status={entry.reviewStatus} size={rank === 1 ? 32 : 26} index={index} />
          ) : (
            <span class="ed-lbrow__seal-slot" aria-hidden="true" />
          )}
          <span class="ed-lbrow__score">
            {score}
            {entry.timeMs !== undefined && (
              <small class="ed-lbrow__time">{formatLeaderboardSeconds(entry.timeMs)}s</small>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

// Desktop's mode rows read rather than play, so the Ladder has to be openable
// ON a board rather than only at its default one. Read once at mount: the board
// picker owns the mode from then on, and a later navigation within the Ladder
// must not yank it back to the query it arrived with.
function initialBoardMode(value: string): GameMode {
  const requested = boardModeFromRoute(value)
  return RANKED_GAMES.some((game) => game.mode === requested) ? (requested as GameMode) : 'surge'
}

export default function Leaderboards() {
  const mode = useSignal<GameMode>(initialBoardMode(route.peek()))
  const uiScope = useSignal<UiScope>('boards')
  // '' = the current season (default), 'all-time', or a specific season id.
  const period = useSignal<string>('')
  const entries = useSignal<LeaderboardEntry[]>([])
  const season = useSignal<Season | null>(null)
  const seasons = useSignal<Array<{ id: string; crSeasonId?: number }>>([])
  const activeClan = useSignal<{ tag: string; name: string } | null>(null)
  const clanGate = useSignal<ClanGate>(null)
  const loading = useSignal(true)
  const error = useSignal('')
  const xpTimeline = useSignal<XpTimeline | null>(null)
  const xpLoading = useSignal(false)
  const xpError = useSignal('')
  const xpReload = useSignal(0)

  const currentPlayer = player.value
  const currentAccountStatus = accountStatus.value
  const currentClan = currentPlayer?.clashRoyale?.clan
  const crStatus = currentPlayer?.clashRoyale?.status

  const isClan = uiScope.value === 'clan'
  const isBadges = uiScope.value === 'badges'
  const isXp = uiScope.value === 'xp'
  // Local capture so the effect can depend on connectivity (a module-level
  // signal is not a valid hook dependency); reading it here also subscribes the
  // component, so a reconnect re-renders and re-runs the fetch.
  const isOffline = offline.value

  useEffect(() => {
    // Badges read the local badge signal and XP has its own owner-only read;
    // neither should keep the board request alive.
    if (isBadges || isXp) {
      loading.value = false
      error.value = ''
      return
    }
    // Offline the boards go quiet rather than error: no fetch, an empty board
    // that names the cause. Badges above still work from the local signal.
    if (isOffline) {
      entries.value = []
      activeClan.value = null
      clanGate.value = null
      loading.value = false
      error.value = ''
      return
    }
    const controller = new AbortController()
    entries.value = []
    activeClan.value = null
    clanGate.value = null
    loading.value = true
    error.value = ''

    if (isClan) {
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

    const apiScope: LeaderboardScope = isClan ? 'clan' : period.value === 'all-time' ? 'all-time' : 'season'
    const seasonId = !isClan && period.value && period.value !== 'all-time' ? period.value : undefined
    void getLeaderboard(mode.value, apiScope, controller.signal, isClan ? sessionToken() : undefined, seasonId)
      .then((response) => {
        entries.value = response.entries
        season.value = response.currentSeason
        if (response.seasons) seasons.value = response.seasons
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
    uiScope.value,
    period.value,
    isOffline,
    isBadges,
    isXp,
    isClan,
    currentAccountStatus,
    currentPlayer,
    currentClan,
    crStatus,
    entries,
    activeClan,
    clanGate,
    error,
    loading,
    season,
    seasons
  ])

  useEffect(() => {
    if (!isXp) return
    if (currentAccountStatus !== 'authenticated' || !currentPlayer || isOffline) {
      xpLoading.value = false
      xpError.value = ''
      return
    }
    const token = sessionToken()
    if (!token) {
      xpLoading.value = false
      xpError.value = 'Your session could not be loaded. Sign in again.'
      return
    }
    const controller = new AbortController()
    xpLoading.value = true
    xpError.value = ''
    void getXpTimeline(token, controller.signal)
      .then((response) => {
        xpTimeline.value = response
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.code === 'request_cancelled') return
        xpError.value = reason instanceof Error ? reason.message : 'XP history could not be loaded.'
      })
      .finally(() => {
        if (!controller.signal.aborted) xpLoading.value = false
      })
    return () => controller.abort()
  }, [isXp, isOffline, currentAccountStatus, currentPlayer, xpReload.value, xpTimeline, xpLoading, xpError])

  // Keep polling while a just-saved player tag resolves to a clan.
  useEffect(() => {
    if (!isClan || !currentPlayer?.playerTag || currentClan || crStatus !== 'pending') return
    const interval = window.setInterval(() => void refreshAccount().catch(() => undefined), 2_000)
    return () => window.clearInterval(interval)
  }, [isClan, currentPlayer?.playerTag, currentClan, crStatus])

  const selectedGame = GAME_BY_MODE.get(mode.value)!
  const clanName = activeClan.value?.name ?? currentClan?.name
  const clanTag = activeClan.value?.tag ?? currentClan?.tag
  const activePeriod = period.value === 'all-time' ? 'all-time' : period.value || season.value?.id || ''
  const views = badgeViews(badges.value)
  const earnedBadges = earnedCount(views)

  const clanGateCard = (gate: Exclude<ClanGate, null>) => {
    const cards: Record<Exclude<ClanGate, null>, { state: string; line: string; label: string; href: string }> = {
      'signed-out': {
        state: 'Ladder signed out',
        line: 'Connect your Drop player to see how you rank against clanmates.',
        label: 'Sign in',
        href: '/login'
      },
      'tag-required': {
        state: 'Clan tag needed',
        line: 'Drop uses your public Clash Royale profile to find your current clan.',
        label: 'Add player tag',
        href: '/profile?edit=player-tag'
      },
      'profile-pending': {
        state: 'Loading your clan',
        line: 'Your player tag is saved. Drop is fetching its public Clash Royale profile.',
        label: 'View profile',
        href: '/profile'
      },
      'profile-missing': {
        state: 'Clan tag not found',
        line: 'Check the tag on your profile, then open Clan again.',
        label: 'Edit player tag',
        href: '/profile?edit=player-tag'
      },
      'no-clan': {
        state: 'No clan connected',
        line: 'Your linked Clash Royale profile is not currently in a clan.',
        label: 'View profile',
        href: '/profile'
      }
    }
    const card = cards[gate]
    return (
      <GateCard mark={<Icon name="shield" />} state={card.state} primary={{ label: card.label, href: card.href }}>
        {card.line}
      </GateCard>
    )
  }

  return (
    <div class="ed-board ed-ladder leaderboard-screen">
      <CauseChip />
      <header class="ed-ladder__head">
        <div class="ed-ladder__titlerow">
          <div class="ed-ladder__title" aria-hidden="true">
            Ladder
          </div>
          {!isBadges && !isXp && <div class="ed-ladder__clock">{seasonEndLine(season.value)}</div>}
        </div>
      </header>

      <ScopeRow
        ariaLabel="Choose a Ladder scope"
        active={uiScope.value}
        onSelect={(key) => (uiScope.value = key)}
        options={[
          { key: 'boards', label: 'Boards' },
          { key: 'badges', label: 'Badges' },
          { key: 'clan', label: 'Clan' },
          { key: 'xp', label: 'XP' }
        ]}
      />

      {isClan && !clanGate.value && (
        <div class="ed-board__clan">
          <span class="ed-board__crest" aria-hidden="true">
            <Icon name="shield" />
          </span>
          <span class="ed-board__clan-ident">
            <strong>{clanName ?? 'Clan'}</strong>
            <small>
              {clanTag ? `${clanTag} · ` : ''}
              {entries.value.length} {entries.value.length === 1 ? 'clanmate' : 'clanmates'} on Drop
            </small>
          </span>
          <button class="ed-textlink" onClick={() => navigate('/profile?edit=player-tag')}>
            Change <Icon name="chevron-right" />
          </button>
        </div>
      )}

      {uiScope.value === 'boards' && (
        <div class="ed-ladder__periods" aria-label="Choose a board period">
          <div class="ed-ladder__periods-track">
            <button
              class={`ed-period${activePeriod === 'all-time' ? ' ed-period--active' : ''}`}
              aria-pressed={activePeriod === 'all-time'}
              onClick={() => (period.value = 'all-time')}
            >
              All-time
            </button>
            {seasons.value.map((s) => (
              <button
                key={s.id}
                class={`ed-period${activePeriod === s.id ? ' ed-period--active' : ''}`}
                aria-pressed={activePeriod === s.id}
                onClick={() => (period.value = s.id)}
              >
                {s.crSeasonId ? `Season ${s.crSeasonId}` : s.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isBadges && !isXp && (
        <div class="ed-board__mode-strip">
          <div class="ed-board__modes" aria-label="Choose a game leaderboard">
            {RANKED_GAMES.map((game) => (
              <button
                aria-pressed={mode.value === game.mode}
                class={`ed-modetab${mode.value === game.mode ? ' ed-modetab--active' : ''}`}
                onClick={() => (mode.value = game.mode)}
                key={game.mode}
              >
                <ModeIcon mode={game.mode} size={28} />
                <span class="ed-modetab__label">{MODE_TAB_LABEL[game.mode] ?? game.name.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isBadges ? (
        <section class="ed-ladder__badges" aria-label="Your badges">
          {currentAccountStatus === 'authenticated' ? (
            <>
              <div class="ed-ladder__badges-head">
                <strong>
                  {earnedBadges} of {BADGE_LIST.length} earned
                </strong>
              </div>
              <BadgeGrid states={badges.value} playerId={currentPlayer?.id} playerName={currentPlayer?.publicName} />
            </>
          ) : (
            <GateCard
              mark={<Icon name="trophy" />}
              state="Ladder signed out"
              primary={{ label: 'Sign in', href: '/login' }}
            >
              Sign in to track your badges across every game you play.
            </GateCard>
          )}
        </section>
      ) : isXp ? (
        <section class="ed-ladder__xp" aria-label="Your XP history">
          {currentAccountStatus === 'anonymous' ? (
            <GateCard
              mark={<Icon name="zap" />}
              state="Ladder signed out"
              primary={{ label: 'Sign in', href: '/login' }}
            >
              Sign in to see how every game and milestone built your Player XP.
            </GateCard>
          ) : currentAccountStatus === 'loading' ? (
            <SkeletonRows count={4} className="ed-skeleton--board" />
          ) : xpTimeline.value ? (
            <XpTimelinePanel timeline={xpTimeline.value} stale={isOffline} />
          ) : isOffline && currentPlayer ? (
            <XpTimelinePanel
              timeline={{
                totalXp: currentPlayer.xp,
                attributedXp: 0,
                openingBalance: 0,
                timeZone: 'UTC',
                days: []
              }}
              stale
              historyUnavailable
            />
          ) : isOffline ? (
            <GateCard
              mark={<Icon name="zap" />}
              state="XP history needs a connection"
              primary={{ label: 'Choose a game', href: '/' }}
            >
              Reconnect once to load your detailed XP history. Offline games never change saved XP.
            </GateCard>
          ) : xpLoading.value ? (
            <SkeletonRows count={4} className="ed-skeleton--board" />
          ) : (
            <GateCard
              mark={<Icon name="zap" />}
              state="XP history unavailable"
              primary={{ label: 'Try again', onAction: () => (xpReload.value += 1) }}
            >
              {xpError.value || 'Drop could not load your XP history.'}
            </GateCard>
          )}
        </section>
      ) : (
        <section class="ed-board__list leaderboard-list" aria-labelledby="active-leaderboard-title">
          <h2 id="active-leaderboard-title" class="sr-only">
            {selectedGame.name} leaderboard
          </h2>
          {loading.value && <SkeletonRows count={8} className="ed-skeleton--board" />}
          {error.value && <div class="ed-board__error">{error.value}</div>}
          {!loading.value && !error.value && isClan && clanGate.value && clanGateCard(clanGate.value)}
          {!loading.value && !error.value && (!isClan || !clanGate.value) && (
            <ol class="ed-board__rows">
              {entries.value.map((entry, index) => (
                <LeaderboardRow
                  entry={entry}
                  mode={mode.value}
                  index={index}
                  rankOverride={isClan ? index + 1 : undefined}
                  key={entry.player.id}
                />
              ))}
              {!entries.value.length && (
                <li class="ed-board__empty">
                  <EmptyState
                    art="empty-board"
                    heading={
                      offline.value
                        ? 'Boards need a connection'
                        : isClan
                          ? 'No clanmates have posted'
                          : 'Nobody has posted'
                    }
                    line={
                      offline.value
                        ? 'Reconnect to see the standings — every game still plays offline.'
                        : isClan
                          ? 'First clan run takes the crown.'
                          : 'First run on this board takes the crown.'
                    }
                    actionLabel={offline.value ? 'Choose a game' : `Play ${selectedGame.name}`}
                    href={offline.value ? '/' : selectedGame.path}
                  />
                </li>
              )}
            </ol>
          )}
          {isClan && !clanGate.value && !loading.value && !error.value && (
            <div class="ed-clan-invite">
              <span class="ed-clan-invite__medal" aria-hidden="true">
                <Icon name="user" />
              </span>
              <span class="ed-clan-invite__text">
                <strong>Bring a clanmate in</strong>
              </span>
              <a class="ed-btn ed-btn--gold ed-btn--sm" href={CLAN_INVITE_URL} target="_blank" rel="noreferrer">
                Invite
              </a>
            </div>
          )}
        </section>
      )}

      {!isBadges && !isXp && (
        <footer class="ed-board__key">
          <ReviewStatusMark status="reviewed" size={18} />
          <span>Cleared by a referee.</span>
          <ReviewStatusMark status="pending" size={18} />
          <span>means the run ranks while it is checked; excluded runs leave the board.</span>
          <a class="ed-textlink" href="/fair-play/">
            Fair Play
          </a>
        </footer>
      )}
    </div>
  )
}
