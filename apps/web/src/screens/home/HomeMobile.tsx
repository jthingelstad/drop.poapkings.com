import Icon from '../../components/Icon'
import PlayerAvatar from '../../components/PlayerAvatar'
import Wordmark from '../../components/brand/Wordmark'
import { navigate } from '../../lib/router'
import { player, accountStatus } from '../../lib/account'
import { scoreLabel } from '../../lib/game-metadata'
import { registerLogoTap } from '../../lib/screensaver'
import InstallPrompt from '../../components/InstallPrompt'
import type { LeaderboardEntry } from '../../lib/api'
import type { HomeData } from './home-data'
import { MORE_GAMES } from './home-games'
import { SurgeHero, MoreGameCard } from './home-bits'

function IdentityChip() {
  const current = player.value
  const authed = accountStatus.value === 'authenticated' && !!current
  return (
    <button class="ed-idchip tap-fx" onClick={() => navigate('/profile')}>
      <span class="ed-idchip__avatar">
        <PlayerAvatar favoriteCardId={current?.favoriteCardId} size="small" />
        {authed && current && <span class="ed-idchip__level">{current.level}</span>}
      </span>
      <span class="ed-idchip__text">
        <span class="ed-idchip__name">{authed && current ? current.publicName : 'Guest'}</span>
        <span class="ed-idchip__sub">
          {authed && current ? `Level ${current.level}` : 'Sign in to save your scores'}
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  )
}

function StandingsPeek({ data }: { data: HomeData }) {
  const rows = data.surgeStandings
  const top = rows[0]
  const meId = player.value?.id
  const mine = meId ? rows.find((e) => e.player.id === meId) : undefined
  const second: LeaderboardEntry | undefined = mine && mine.rank > 1 ? mine : rows[1]
  const list = [top, second].filter((e): e is LeaderboardEntry => !!e)
  return (
    <button class="ed-standpeek tap-fx" onClick={() => navigate('/leaderboards')}>
      <span class="ed-standpeek__head">
        <span class="ed-standpeek__title">Season standings</span>
        <span class="ed-standpeek__more">Full board →</span>
      </span>
      {list.map((e) => {
        const you = e.player.id === meId
        return (
          <span class={`ed-standpeek__row${you ? ' ed-standpeek__row--you' : ''}`} key={e.player.id}>
            <span class="ed-standpeek__rank" data-top={e.rank === 1 ? '' : undefined}>
              {e.rank}
            </span>
            <span class="ed-standpeek__name">{you ? 'You' : e.player.publicName}</span>
            <span class="ed-standpeek__score">{scoreLabel('surge', e.score)}</span>
          </span>
        )
      })}
      {!list.length && <span class="ed-standpeek__empty">No runs yet — first score takes the crown.</span>}
    </button>
  )
}

export default function HomeMobile({ data }: { data: HomeData }) {
  return (
    <div class="ed-home">
      <IdentityChip />
      <SurgeHero data={data} />

      <section class="ed-more">
        <div class="ed-more__head">
          <span class="ed-more__title" onClick={() => registerLogoTap()}>
            More games
          </span>
          <span class="ed-more__hint">swipe →</span>
        </div>
        <div class="ed-more-row">
          {MORE_GAMES.map((g) => (
            <MoreGameCard game={g} championFor={data.championFor} key={g.key} />
          ))}
        </div>
      </section>

      <button class="ed-practice tap-fx" onClick={() => navigate('/practice')}>
        <span class="ed-practice__icon">
          <Icon name="target" />
        </span>
        <span class="ed-practice__text">
          <span class="ed-practice__name">Practice</span>
          <span class="ed-practice__sub">No clock, no ranks — learn at your pace.</span>
        </span>
        <span class="ed-practice__play">
          <Icon name="play" /> Play
        </span>
      </button>

      <StandingsPeek data={data} />

      <InstallPrompt />

      <div class="ed-home__foot">
        <Wordmark />
      </div>
    </div>
  )
}
