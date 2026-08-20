import type { GameMode } from '@elixir-drop/contracts'
import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import CauseChip from '../../components/CauseChip'
import Wordmark from '../../components/brand/Wordmark'
import { offline } from '../../lib/api-availability'
import { navigate } from '../../lib/router'
import { boardRouteForMode } from '../../lib/game-routes'
import { layout } from '../../lib/use-layout'
import { registerLogoTap } from '../../lib/screensaver'
import { scoreLabel } from '../../lib/game-metadata'
import { InstallBanner, InstallRow } from '../../components/InstallPrompt'
import type { HomeData } from './home-data'
import { ALL_GAMES, featuredGame } from './home-games'
import { HomeHeroCarousel, HomeRow } from './home-bits'

export default function HomeMobile({ data }: { data: HomeData }) {
  const featured = featuredGame()
  // Desktop reorders the shared content to fit all six games in its first
  // viewport and gives every ranked row a direct play action plus a board link.
  const onDesktop = layout.value === 'desktop'
  // The featured game leads in the hero; it must not appear again in the list.
  const others = ALL_GAMES.filter((game) => game.key !== featured.key)
  const seasonLabel = data.season?.crSeasonId ? `Season ${data.season.crSeasonId}` : ''

  // Offline, personal bests and ranks go quiet rather than apologise: the whole
  // meta line is season context the device cannot vouch for while disconnected.
  const rowMeta = (mode: GameMode): string => {
    if (offline.value) return '—'
    const best = data.bestScores[mode]
    const rank = data.rankFor(mode)
    const bestText = best === undefined ? 'Best —' : `Best ${scoreLabel(mode, best)}`
    return rank ? `${bestText} · #${rank} this season` : bestText
  }

  const rankedSection = (
    <section class="ed-more ed-more--ranked">
      <div class="ed-more__head">
        <span class="ed-more__title" onClick={() => registerLogoTap()}>
          {onDesktop ? 'Ranked games' : 'The other four'}
        </span>
        {seasonLabel && <span class="ed-more__aside">{seasonLabel}</span>}
      </div>
      <div class="ed-rows">
        {(onDesktop ? ALL_GAMES : others).map((game) => (
          <HomeRow
            key={game.key}
            tone="ranked"
            name={game.name}
            meta={rowMeta(game.mode)}
            visual={<ModeIcon mode={game.mode} size={46} />}
            onClick={() => navigate(game.path)}
            boardAction={onDesktop ? () => navigate(boardRouteForMode(game.mode)) : undefined}
          />
        ))}
      </div>
    </section>
  )

  const practiceSection = (
    <section class="ed-more ed-more--practice" aria-labelledby="home-practice-title">
      <div class="ed-more__head">
        <span class="ed-more__title" id="home-practice-title">
          Practice
        </span>
        <span class="ed-more__aside ed-more__aside--pill">UNRANKED</span>
      </div>
      <div class="ed-rows">
        <HomeRow
          tone="drill"
          name="Practice"
          meta="Card knowledge"
          visual={
            <span class="ed-grow__glyph">
              <Icon name="zap" />
            </span>
          }
          onClick={() => navigate('/practice')}
        />
      </div>
    </section>
  )

  return (
    <div class="ed-home">
      <InstallBanner />
      <CauseChip />
      <HomeHeroCarousel data={data} game={featured} />

      {onDesktop ? practiceSection : rankedSection}
      {onDesktop ? rankedSection : practiceSection}

      <p class="ed-home__ready">
        {offline.value ? 'You are offline but ready to play' : 'Games are available to play offline'}
      </p>

      <InstallRow />

      <div class="ed-home__foot">
        <Wordmark />
      </div>
    </div>
  )
}
