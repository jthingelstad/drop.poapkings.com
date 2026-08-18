import type { GameMode } from '@elixir-drop/contracts'
import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import CauseChip from '../../components/CauseChip'
import Wordmark from '../../components/brand/Wordmark'
import { offline } from '../../lib/api-availability'
import { navigate } from '../../lib/router'
import { registerLogoTap } from '../../lib/screensaver'
import { scoreLabel } from '../../lib/game-metadata'
import { InstallBanner, InstallRow } from '../../components/InstallPrompt'
import type { HomeData } from './home-data'
import { ALL_GAMES, featuredGame } from './home-games'
import { HomeHeroCarousel, HomeRow } from './home-bits'

// The two focused drills, held under one "Practice" list with an UNRANKED pill —
// the practice hub is retired as a destination, so nothing points at /practice.
const DRILLS = [
  { path: '/practice/costs', name: 'Cost Recall', meta: 'Card knowledge', icon: 'zap' as const },
  { path: '/practice/ledger', name: 'Ledger', meta: 'Battle awareness', icon: 'trending-up' as const }
]

export default function HomeMobile({ data }: { data: HomeData }) {
  const featured = featuredGame()
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

  return (
    <div class="ed-home">
      <InstallBanner />
      <CauseChip />
      <HomeHeroCarousel data={data} game={featured} />

      <section class="ed-more">
        <div class="ed-more__head">
          <span class="ed-more__title" onClick={() => registerLogoTap()}>
            The other four
          </span>
          {seasonLabel && <span class="ed-more__aside">{seasonLabel}</span>}
        </div>
        <div class="ed-rows">
          {others.map((game) => (
            <HomeRow
              key={game.key}
              tone="ranked"
              name={game.name}
              meta={rowMeta(game.mode)}
              visual={<ModeIcon mode={game.mode} size={46} />}
              onClick={() => navigate(game.path)}
            />
          ))}
        </div>
      </section>

      <section class="ed-more" aria-labelledby="home-practice-title">
        <div class="ed-more__head">
          <span class="ed-more__title" id="home-practice-title">
            Practice
          </span>
          <span class="ed-more__aside ed-more__aside--pill">UNRANKED</span>
        </div>
        <div class="ed-rows">
          {DRILLS.map((drill) => (
            <HomeRow
              key={drill.path}
              tone="drill"
              name={drill.name}
              meta={drill.meta}
              visual={
                <span class="ed-grow__glyph">
                  <Icon name={drill.icon} />
                </span>
              }
              onClick={() => navigate(drill.path)}
            />
          ))}
        </div>
      </section>

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
