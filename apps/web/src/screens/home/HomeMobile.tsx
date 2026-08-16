import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import PlayerAvatar from '../../components/PlayerAvatar'
import Wordmark from '../../components/brand/Wordmark'
import OfflineGlyph from '../../components/OfflineGlyph'
import { offline } from '../../lib/api-availability'
import { navigate } from '../../lib/router'
import { player, accountStatus } from '../../lib/account'
import { registerLogoTap } from '../../lib/screensaver'
import { InstallBanner, InstallRow } from '../../components/InstallPrompt'
import type { HomeData } from './home-data'
import { ALL_GAMES, featuredGame } from './home-games'
import { HomeHeroCarousel, HomeGameCard } from './home-bits'

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
        <span class="ed-idchip__name">
          {authed && current ? current.publicName : 'Guest'}
          {offline.value && <OfflineGlyph />}
        </span>
        <span class="ed-idchip__sub">
          {authed && current ? `Level ${current.level}` : 'Sign in to save your scores'}
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  )
}

export default function HomeMobile({ data }: { data: HomeData }) {
  const featured = featuredGame()
  return (
    <div class="ed-home">
      <InstallBanner />
      <header class="ed-home-intro">
        <h1>Elixir Drop</h1>
        <p>Learn Clash Royale card elixir costs through six fast games.</p>
      </header>
      <IdentityChip />
      <HomeHeroCarousel data={data} game={featured} />

      <section class="ed-more">
        <div class="ed-more__head">
          <span class="ed-more__title" onClick={() => registerLogoTap()}>
            All games
          </span>
          <span class="ed-more__hint">
            swipe <Icon name="arrow-right" />
          </span>
        </div>
        <div class="ed-more-row">
          {ALL_GAMES.map((g) => (
            <HomeGameCard
              game={g}
              featured={g.key === featured.key}
              best={data.personalBestScores[g.mode]}
              key={g.key}
            />
          ))}
        </div>
      </section>

      <button class="ed-practice tap-fx" onClick={() => navigate('/practice')}>
        <ModeIcon mode="practice" size={38} className="ed-practice__art" />
        <span class="ed-practice__text">
          <span class="ed-practice__name">Practice</span>
          <span class="ed-practice__sub">No clock, no ranks — learn at your pace.</span>
        </span>
        <span class="ed-practice__play">
          <Icon name="play" /> {offline.value ? 'Play offline' : 'Play'}
        </span>
      </button>

      <InstallRow />

      <div class="ed-home__foot">
        <Wordmark />
      </div>
    </div>
  )
}
