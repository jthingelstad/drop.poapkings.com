import { useEffect } from 'preact/hooks'
import { route, navigate } from './lib/router'
import { track } from './lib/analytics'
import StarCount from './components/StarCount'
import Practice from './modes/practice/Practice'
import Surge from './modes/surge/Surge'
import HigherLower from './modes/higher-lower/HigherLower'
import Blitz from './modes/blitz/Blitz'
import Survival from './modes/survival/Survival'
import SpeedLadder from './modes/ladder/SpeedLadder'
import SettingsScreen from './modes/settings/Settings'

const POAP_KINGS = 'https://poapkings.com'

interface Mode {
  path: string
  name: string
  icon: string
  desc: string
}

const GRID_MODES: Mode[] = [
  { path: '/practice', name: 'Practice', icon: '🎯', desc: 'Learn elixir costs at your own pace — no clock.' },
  { path: '/higher-lower', name: 'Higher / Lower', icon: '⚖️', desc: 'Two cards — which one costs more?' },
  { path: '/ladder', name: 'Speed Ladder', icon: '↕️', desc: 'Sort five cards from cheap to expensive.' },
  { path: '/blitz', name: 'Blitz', icon: '⏱️', desc: '60 seconds — how many can you clear?' },
  { path: '/survival', name: 'Survival', icon: '💀', desc: 'Sudden death — one miss ends the run.' }
]

// ── Home ──────────────────────────────────────────────────────────────────────

function GameCard({ m }: { m: Mode }) {
  return (
    <button class="game-card" onClick={() => navigate(m.path)}>
      <span class="game-card__icon">{m.icon}</span>
      <span class="game-card__info">
        <span class="game-card__name">{m.name}</span>
        <span class="game-card__desc">{m.desc}</span>
      </span>
      <span class="game-card__arrow">→</span>
    </button>
  )
}

function Home() {
  return (
    <div class="home">
      <div class="hero">
        <div class="hero__inner">
          <h1 class="hero__title">
            <span class="t-elixir">ELIXIR</span>
            <span class="t-drop">DROP</span>
          </h1>
          <p class="hero__sub">Train your Clash Royale elixir instinct. Read the board faster. Win more trades.</p>
          <div class="hero__cta">
            <button class="btn btn--gold btn--lg" onClick={() => navigate('/surge')}>
              ▶ Play Surge
            </button>
            <a class="btn btn--ghost btn--lg" href="#games">
              Browse games
            </a>
          </div>
        </div>
      </div>

      <div class="home__wrap">
        <div class="statstrip">
          <div class="statstrip__cell">
            <div class="statstrip__n">120</div>
            <div class="statstrip__l">Cards in catalog</div>
          </div>
          <div class="statstrip__cell">
            <div class="statstrip__n">6</div>
            <div class="statstrip__l">Ways to play</div>
          </div>
          <div class="statstrip__cell">
            <div class="statstrip__n">
              28.6<span class="statstrip__u">s</span>
            </div>
            <div class="statstrip__l">Surge to beat</div>
          </div>
        </div>

        <div class="sec">
          <div class="sec__head">
            <h2 class="sec__title">Start here</h2>
            <span class="sec__hint">The flagship</span>
          </div>
          <div class="spotlight">
            <div
              class="spotlight__bg"
              style={{ backgroundImage: "url('/assets/arenas/24-legendary-arena.png')" }}
              aria-hidden="true"
            />
            <div class="spotlight__glow" aria-hidden="true" />
            <div class="spotlight__body">
              <span class="pill pill--gold">⚡ Flagship mode</span>
              <h3 class="spotlight__title">Surge</h3>
              <p class="spotlight__desc">
                15 cards. Tap each elixir cost as fast as you can. Miss and the clock bites. One honest, shareable time.
              </p>
              <div class="spotlight__meta">
                <div class="spot-stat">
                  <span class="spot-stat__n">15</span>
                  <span class="spot-stat__l">Cards</span>
                </div>
                <div class="spot-stat">
                  <span class="spot-stat__n">+2.0s</span>
                  <span class="spot-stat__l">Per miss</span>
                </div>
                <div class="spot-stat">
                  <span class="spot-stat__n">~40s</span>
                  <span class="spot-stat__l">A run</span>
                </div>
              </div>
              <div class="spotlight__cta">
                <button class="btn btn--gold btn--lg" onClick={() => navigate('/surge')}>
                  ▶ Play Surge
                </button>
              </div>
            </div>
            <div class="spotlight__art">
              <img src="/assets/elixir-hype.png" alt="" />
            </div>
          </div>
        </div>

        <div class="sec" id="games">
          <div class="sec__head">
            <h2 class="sec__title">More ways to play</h2>
            <span class="sec__hint">Same cards, different pressure</span>
          </div>
          <div class="games">
            {GRID_MODES.map((m) => (
              <GameCard m={m} key={m.path} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

const ROUTE_LABELS: { match: string; label: string }[] = [
  { match: '/practice', label: 'Practice' },
  { match: '/surge', label: 'Surge' },
  { match: '/higher-lower', label: 'Higher / Lower' },
  { match: '/blitz', label: 'Blitz' },
  { match: '/survival', label: 'Survival' },
  { match: '/ladder', label: 'Speed Ladder' }
]

function Header() {
  const r = route.value
  const active = ROUTE_LABELS.find((x) => r.startsWith(x.match))
  return (
    <header class="site-head">
      <button class="site-head__brand" onClick={() => navigate('/')} aria-label="Elixir Drop home">
        <img src="/assets/emoji/elixir.png" alt="" class="site-head__logo" aria-hidden="true" />
        <span class="site-head__name">Elixir Drop</span>
      </button>

      {active && <span class="pill pill--purple site-head__crumb">{active.label}</span>}

      <div class="site-head__spacer" />

      <StarCount />
      <button class="site-head__settings" onClick={() => navigate('/settings')} aria-label="Settings" title="Settings">
        ⚙
      </button>
    </header>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer class="site-foot">
      <div class="site-foot__run">
        Run by{' '}
        <a href={POAP_KINGS} target="_blank" rel="noopener noreferrer">
          POAP KINGS
        </a>
      </div>
      <div class="site-foot__disc">
        This fan community is not affiliated with{' '}
        <a href="https://supercell.com" target="_blank" rel="noopener noreferrer">
          Supercell
        </a>
        . Clash Royale is a trademark of its respective owner. Card data and artwork © Supercell, used under Supercell's
        Fan Content Policy.
      </div>
    </footer>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

function Screen({ r }: { r: string }) {
  if (r.startsWith('/practice')) return <Practice />
  if (r.startsWith('/surge')) return <Surge />
  if (r.startsWith('/higher-lower')) return <HigherLower />
  if (r.startsWith('/blitz')) return <Blitz />
  if (r.startsWith('/survival')) return <Survival />
  if (r.startsWith('/ladder')) return <SpeedLadder />
  if (r.startsWith('/settings')) return <SettingsScreen />
  return <Home />
}

function screenTitle(r: string): string | null {
  if (r === '/') return null
  return ROUTE_LABELS.find((x) => r.startsWith(x.match))?.label ?? 'Elixir Drop'
}

export default function App() {
  useEffect(() => {
    track('game.start')
  }, [])

  const title = screenTitle(route.value)

  return (
    <>
      <Header />
      <main>
        {title && <h1 class="sr-only">{title}</h1>}
        <Screen r={route.value} />
      </main>
      <Footer />
    </>
  )
}
