import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import PracticeDrills from '../../components/PracticeDrills'
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
        <p>Five competitive games and two focused practice drills.</p>
      </header>
      <IdentityChip />
      <HomeHeroCarousel data={data} game={featured} />

      <section class="ed-more">
        <div class="ed-more__head">
          <span class="ed-more__title" onClick={() => registerLogoTap()}>
            All games
          </span>
          <a class="ed-textlink" href="/games/">
            How every mode works <Icon name="arrow-right" />
          </a>
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

      <section class="ed-practice-options" aria-labelledby="practice-options-title">
        <header class="ed-practice-options__head">
          <div>
            <span class="ed-practice-options__eyebrow">Training grounds</span>
            <h2 id="practice-options-title">Practice options</h2>
            <p>No clock, no ranks — choose a focused drill and learn at your pace.</p>
          </div>
          <span class="ed-practice-options__badge">
            <ModeIcon mode="practice" size={30} /> Unranked
          </span>
        </header>
        <PracticeDrills />
      </section>

      <InstallRow />

      <div class="ed-home__foot">
        <Wordmark />
      </div>
    </div>
  )
}
