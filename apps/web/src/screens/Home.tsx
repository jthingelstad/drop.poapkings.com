// Home — one component on both shells. There is no mobile Home and no desktop
// Home: the same hero, the same fixed game order, the same rows, composed
// differently only by MobileShell around it. Desktop plays ranked runs, so the
// three things that once forked this screen — Practice leading the column, rows
// that opened a board instead of starting a run, and a QR bridge off the gate —
// were all workarounds for a restriction that no longer exists. There is no
// `layout.value` branch here, and there should never be one again.

import type { GameMode } from '@elixir-drop/contracts'
import ModeIcon from '../components/ModeIcon'
import CauseChip from '../components/CauseChip'
import Wordmark from '../components/brand/Wordmark'
import { offline } from '../lib/api-availability'
import { navigate } from '../lib/router'
import { registerLogoTap } from '../lib/screensaver'
import { scoreLabel } from '../lib/game-metadata'
import { InstallBanner, InstallRow } from '../components/InstallPrompt'
import { useHomeData } from './home/home-data'
import { ALL_GAMES, featuredGame } from './home/home-games'
import { HomeHeroCarousel, HomeRow } from './home/home-bits'

export default function Home() {
  const data = useHomeData()
  const featured = featuredGame()
  // The featured game leads in the hero; it must not appear again in the list.
  // This is the order on every shell — desktop does not reshuffle the game.
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

  // "Games", not a count. The list has already changed twice — Rain joined the
  // ranked modes and a drill left — and a heading that has to be edited when the
  // list changes is a heading that will be wrong.
  const rankedSection = (
    <section class="ed-more ed-more--ranked">
      <div class="ed-more__head">
        <span class="ed-more__title">Games</span>
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
        {/* Its own mode art, like every other row. One row drawn in a different
            medium — a lucide glyph in a tinted tile — read as unfinished. */}
        <HomeRow
          tone="drill"
          name="Practice"
          meta="Card knowledge · no clock"
          visual={<ModeIcon mode="practice" size={46} />}
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

      {rankedSection}
      {practiceSection}

      {/* A rule and a hollow mark, not a banner: it is a standing fact about the
          app, so it sits at the foot of the list rather than interrupting it. */}
      <p class="ed-home__ready">
        <span class="ed-home__ready-mark" aria-hidden="true" />
        {offline.value ? 'You are offline but ready to play' : 'Games are available to play offline'}
      </p>

      <InstallRow />

      {/* The screensaver's tap door lives on the LOGO, which is what the
          function is named after. On a section title it was a tap target doing
          something unrelated to its own label. */}
      <div class="ed-home__foot">
        <Wordmark onLogoTap={registerLogoTap} />
      </div>
    </div>
  )
}
