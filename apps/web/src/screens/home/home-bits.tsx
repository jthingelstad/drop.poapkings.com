// Shared Home presentation bits used by both HomeMobile and HomeDesktop: the
// ambient elixir motes, and the "More games" card (whose inner content is
// identical across layouts — only the surrounding container/grid differs).

import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { scoreLabel } from '../../lib/game-metadata'
import type { GameMode } from '@elixir-drop/contracts'
import type { LeaderboardEntry } from '../../lib/api'
import type { HomeGame } from './home-games'
import { seasonEndsLabel, type HomeData } from './home-data'

// Falling elixir motes inside a card (CSS-animated, decorative).
export function GameMotes({ dense = false }: { dense?: boolean }) {
  return (
    <span class="ed-fx" aria-hidden="true">
      <span class="ed-cell-drop" style={{ left: '66%' }} />
      <span class="ed-cell-drop" style={{ left: '26%', animationDelay: '1.4s' }} />
      {dense && <span class="ed-cell-drop" style={{ left: '80%', animationDelay: '2.1s' }} />}
      {!dense && <span class="ed-cell-sheen" style={{ animationDelay: '0.3s' }} />}
    </span>
  )
}

function championText(game: HomeGame, championFor: (m: GameMode) => LeaderboardEntry | undefined): string {
  const champ = championFor(game.mode)
  if (!champ) return 'The crown is open'
  return `${champ.player.publicName} · ${scoreLabel(game.mode, champ.score)}`
}

// `withHours` gives the desktop pill its "6d 04h" form.
// The hero promotes one game a day. It was Surge-only before, which meant the
// only promotion slot on the app's first screen could never say anything new.
export function FeaturedHero({
  data,
  game,
  withHours = false
}: {
  data: HomeData
  game: HomeGame
  withHours?: boolean
}) {
  const best = data.bestScores[game.mode]
  const bestText = best === undefined ? '—' : scoreLabel(game.mode, best)
  const rank = data.rankFor(game.mode)
  const rankText = rank ? `#${rank}` : '—'
  return (
    <section class="ed-hero">
      <span class="ed-fx" aria-hidden="true">
        <span class="ed-cell-drop" style={{ left: '82%' }} />
        <span class="ed-cell-drop" style={{ left: '90%', animationDelay: '1.6s' }} />
        <span class="ed-cell-drop" style={{ left: '70%', animationDelay: '2.6s' }} />
      </span>
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--a" aria-hidden="true" />
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--b" aria-hidden="true" />
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--gold">{seasonEndsLabel(data.season, withHours)}</span>
        <ModeIcon mode={game.mode} size={60} className="ed-hero__art" />
        {/* Long names get their own size step rather than wrapping the
            wordmark, which reads as a broken headline. */}
        <div class={`ed-hero__wordmark${game.name.length > 8 ? ' ed-hero__wordmark--long' : ''}`}>
          {game.name.toLocaleUpperCase()}
        </div>
        <p class="ed-hero__desc">{game.desc}</p>
        <div class="ed-hero__cta">
          <button
            class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
            onClick={(e) => {
              tapFxFrom(e)
              navigate(game.path)
            }}
          >
            <span class="tap-face">
              <Icon name="play" /> PLAY
            </span>
          </button>
          <div class="ed-hero__best">
            <span class="ed-hero__best-label">Best · Rank</span>
            <strong class="ed-hero__best-val">
              {bestText} · {rankText}
            </strong>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HomeGameCard({
  game,
  featured,
  championFor
}: {
  game: HomeGame
  featured: boolean
  championFor: (m: GameMode) => LeaderboardEntry | undefined
}) {
  return (
    <article class={`ed-gcard${featured ? ' ed-gcard--accent' : ''}`}>
      <GameMotes dense={featured} />
      <div class="ed-gcard__body">
        <div class="ed-gcard__title">
          <ModeIcon mode={game.mode} size={50} className="ed-gcard__art" />
          {game.name}
          {game.badge && <span class="ed-gcard__badge">{game.badge}</span>}
        </div>
        <p class="ed-gcard__desc">{game.desc}</p>
        <div class="ed-gcard__champ">
          <Icon name="trophy" />
          <span>{championText(game, championFor)}</span>
        </div>
        <button
          class="ed-btn ed-btn--gold ed-btn--sm tap-fx"
          onClick={(e) => {
            tapFxFrom(e)
            navigate(game.path)
          }}
        >
          <span class="tap-face">
            <Icon name="play" /> Play
          </span>
        </button>
      </div>
    </article>
  )
}
