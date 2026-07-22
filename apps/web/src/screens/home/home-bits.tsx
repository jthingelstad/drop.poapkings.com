// Shared Home presentation bits used by both HomeMobile and HomeDesktop: the
// ambient elixir motes, and the "More games" card (whose inner content is
// identical across layouts — only the surrounding container/grid differs).

import Icon from '../../components/Icon'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { scoreLabel } from '../../lib/game-metadata'
import type { GameMode } from '@elixir-drop/contracts'
import type { LeaderboardEntry } from '../../lib/api'
import type { MoreGame } from './home-games'
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

function championText(game: MoreGame, championFor: (m: GameMode) => LeaderboardEntry | undefined): string {
  if (!game.mode) return 'New this season'
  const champ = championFor(game.mode)
  if (!champ) return 'The crown is open'
  return `${champ.player.publicName} · ${scoreLabel(game.mode, champ.score)}`
}

// The flagship Surge hero. `withHours` gives the desktop pill its "6d 04h" form.
export function SurgeHero({ data, withHours = false }: { data: HomeData; withHours?: boolean }) {
  const best = data.bestScores.surge
  const bestText = best === undefined ? '—' : scoreLabel('surge', best)
  const rankText = data.surgeRank ? `#${data.surgeRank}` : '—'
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
        <div class="ed-hero__wordmark">SURGE</div>
        <p class="ed-hero__desc">15 cards. Name each elixir cost against the clock.</p>
        <div class="ed-hero__cta">
          <button
            class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
            onClick={(e) => {
              tapFxFrom(e)
              navigate('/surge')
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

export function MoreGameCard({
  game,
  championFor
}: {
  game: MoreGame
  championFor: (m: GameMode) => LeaderboardEntry | undefined
}) {
  return (
    <article class={`ed-gcard${game.accent ? ' ed-gcard--accent' : ''}`}>
      <GameMotes dense={!!game.accent} />
      <div class="ed-gcard__body">
        <div class="ed-gcard__title">
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
