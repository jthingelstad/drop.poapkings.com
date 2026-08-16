import Icon from '../../components/Icon'
import { seasonEndsLabel, type HomeData } from './home-data'
import { ALL_GAMES, featuredGame } from './home-games'
import { HomeHeroCarousel, HomeGameCard } from './home-bits'

export default function HomeDesktop({ data }: { data: HomeData }) {
  const featured = featuredGame()
  return (
    <div class="ed-home-d">
      <div class="ed-home-d__head">
        <div class="ed-home-d__identity">
          <h1 class="ed-h1">Elixir Drop</h1>
          <p>Five competitive games plus focused practice drills.</p>
        </div>
        <span class="ed-pill ed-pill--muted">
          <Icon name="clock" />
          {seasonEndsLabel(data.season, true)}
        </span>
      </div>

      <HomeHeroCarousel data={data} game={featured} withHours />

      <div class="ed-more__head">
        <span class="ed-more__title">All games</span>
        <a class="ed-textlink" href="/games/">
          How every mode works <Icon name="arrow-right" />
        </a>
      </div>
      <div class="ed-more-grid">
        {ALL_GAMES.map((g) => (
          <HomeGameCard game={g} featured={g.key === featured.key} best={data.personalBestScores[g.mode]} key={g.key} />
        ))}
      </div>
    </div>
  )
}
