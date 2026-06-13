import { useEffect } from 'preact/hooks'
import { route, navigate } from './lib/router'
import { track } from './lib/analytics'
import StarCount from './components/StarCount'
import Practice from './modes/practice/Practice'
import Surge from './modes/surge/Surge'

const CLAN_INVITE = 'https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg'
const DISCORD = 'https://discord.gg/kBD62fYHWx'

interface Mode {
  path: string
  name: string
  desc: string
  ready: boolean
}

const MODES: Mode[] = [
  { path: '/practice', name: 'Practice', desc: 'Learn elixir costs at your own pace', ready: true },
  { path: '/surge', name: 'Surge', desc: 'Speed mode — 15 cards, one honest time', ready: true },
  { path: '/higher-lower', name: 'Higher / Lower', desc: 'Which card costs more?', ready: false }
]

// ── Home ──────────────────────────────────────────────────────────────────────

function Home() {
  return (
    <div class="home">
      <div class="home__hero">
        <div class="home__drop" aria-hidden="true" />
        <h1 class="home__title">Elixir Drop</h1>
        <p class="home__sub">Train your Clash Royale elixir intuition.</p>
      </div>

      <div class="mode-grid">
        {MODES.map((m) =>
          m.ready ? (
            <button class="mode-card" key={m.path} onClick={() => navigate(m.path)}>
              <div class="mode-card__info">
                <div class="mode-card__name">{m.name}</div>
                <div class="mode-card__desc">{m.desc}</div>
              </div>
              <span class="pill pill--live">Ready</span>
              <span class="mode-card__arrow">→</span>
            </button>
          ) : (
            <div class="mode-card mode-card--disabled" key={m.path}>
              <div class="mode-card__info">
                <div class="mode-card__name">{m.name}</div>
                <div class="mode-card__desc">{m.desc}</div>
              </div>
              <span class="pill pill--muted">Soon</span>
            </div>
          )
        )}
      </div>

      <p class="home__foot-note">
        Run by{' '}
        <a href={CLAN_INVITE} target="_blank" rel="noopener noreferrer">
          POAP KINGS
        </a>{' '}
        ·{' '}
        <a href={DISCORD} target="_blank" rel="noopener noreferrer">
          Discord
        </a>
      </p>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

const ROUTE_LABELS: { match: string; label: string }[] = [
  { match: '/practice', label: 'Practice' },
  { match: '/surge', label: 'Surge' },
  { match: '/higher-lower', label: 'Higher / Lower' },
  { match: '/settings', label: 'Settings' }
]

function Header() {
  const r = route.value
  const active = ROUTE_LABELS.find((x) => r.startsWith(x.match))
  return (
    <header class="site-head">
      <button class="site-head__brand" onClick={() => navigate('/')} aria-label="Elixir Drop home">
        <span class="pl-elixir__drop" style={{ width: 14, height: 18 }} />
        <span class="site-head__name">Elixir Drop</span>
      </button>

      {active && <span class="pill pill--purple site-head__crumb">{active.label}</span>}

      <div class="site-head__spacer" />

      <StarCount />
    </header>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer class="site-foot">
      <div>
        This content is not affiliated with, endorsed, sponsored, or specifically approved by Supercell and Supercell is
        not responsible for it. For more information see Supercell's{' '}
        <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noopener noreferrer">
          Fan Content Policy
        </a>
        .
      </div>
      <div style={{ marginTop: 6 }}>
        Run by{' '}
        <a href={CLAN_INVITE} target="_blank" rel="noopener noreferrer">
          POAP KINGS
        </a>
      </div>
    </footer>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

function Screen({ r }: { r: string }) {
  if (r.startsWith('/practice')) return <Practice />
  if (r.startsWith('/surge')) return <Surge />
  return <Home />
}

export default function App() {
  useEffect(() => {
    track('game.start')
  }, [])

  return (
    <>
      <Header />
      <Screen r={route.value} />
      <Footer />
    </>
  )
}
