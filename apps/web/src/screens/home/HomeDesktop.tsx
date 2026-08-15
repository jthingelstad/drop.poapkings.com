import Icon from '../../components/Icon'
import { navigate } from '../../lib/router'
import { seasonEndsLabel, type HomeData } from './home-data'
import { ALL_GAMES, featuredGame } from './home-games'
import { FeaturedHero, HomeGameCard } from './home-bits'

export default function HomeDesktop({ data }: { data: HomeData }) {
  const featured = featuredGame()
  return (
    <div class="ed-home-d">
      <div class="ed-home-d__head">
        <h1 class="ed-h1">Play</h1>
        <span class="ed-pill ed-pill--muted">
          <Icon name="clock" />
          {seasonEndsLabel(data.season, true)}
        </span>
      </div>

      <FeaturedHero data={data} game={featured} withHours />

      <div class="ed-more__head">
        <span class="ed-more__title">All games</span>
        <button class="ed-textlink" onClick={() => navigate('/leaderboards')}>
          All leaderboards <Icon name="arrow-right" />
        </button>
      </div>
      <div class="ed-more-grid">
        {ALL_GAMES.map((g) => (
          <HomeGameCard game={g} featured={g.key === featured.key} championFor={data.championFor} key={g.key} />
        ))}
      </div>
    </div>
  )
}
