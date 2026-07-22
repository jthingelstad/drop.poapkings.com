import Icon from '../../components/Icon'
import InstallPrompt from '../../components/InstallPrompt'
import { navigate } from '../../lib/router'
import { seasonEndsLabel, type HomeData } from './home-data'
import { MORE_GAMES } from './home-games'
import { SurgeHero, MoreGameCard } from './home-bits'

export default function HomeDesktop({ data }: { data: HomeData }) {
  return (
    <div class="ed-home-d">
      <div class="ed-home-d__head">
        <h1 class="ed-h1">Play</h1>
        <span class="ed-pill ed-pill--muted">
          <Icon name="clock" />
          {seasonEndsLabel(data.season, true)}
        </span>
      </div>

      <SurgeHero data={data} withHours />

      <div class="ed-more__head">
        <span class="ed-more__title">More games</span>
        <button class="ed-textlink" onClick={() => navigate('/leaderboards')}>
          All leaderboards →
        </button>
      </div>
      <div class="ed-more-grid">
        {MORE_GAMES.map((g) => (
          <MoreGameCard game={g} championFor={data.championFor} key={g.key} />
        ))}
      </div>

      <InstallPrompt />
    </div>
  )
}
