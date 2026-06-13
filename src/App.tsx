import { signal } from '@preact/signals'
import Practice from './modes/practice/Practice'

// ── Hash router ───────────────────────────────────────────────────────────────

function parseHash(): string {
  const h = window.location.hash
  if (!h || h === '#' || h === '#/') return '/'
  return h.startsWith('#') ? h.slice(1) : h
}

const route = signal<string>(parseHash())

window.addEventListener('hashchange', () => {
  route.value = parseHash()
})

export function navigate(to: string) {
  window.location.hash = to
}

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
        <button class="mode-card" onClick={() => navigate('/practice')}>
          <div class="mode-card__info">
            <div class="mode-card__name">Practice</div>
            <div class="mode-card__desc">Learn elixir costs at your own pace</div>
          </div>
          <span class="pill pill--live">Ready</span>
          <span class="mode-card__arrow">→</span>
        </button>

        <div class="mode-card mode-card--disabled">
          <div class="mode-card__info">
            <div class="mode-card__name">Surge</div>
            <div class="mode-card__desc">Speed mode — 15 cards, one honest time</div>
          </div>
          <span class="pill pill--muted">Soon</span>
        </div>

        <div class="mode-card mode-card--disabled">
          <div class="mode-card__info">
            <div class="mode-card__name">Higher / Lower</div>
            <div class="mode-card__desc">Which card costs more?</div>
          </div>
          <span class="pill pill--muted">Soon</span>
        </div>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>
        Run by{' '}
        <a
          href="https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg"
          target="_blank"
          rel="noopener noreferrer"
        >
          POAP KINGS
        </a>{' '}
        ·{' '}
        <a href="https://discord.gg/kBD62fYHWx" target="_blank" rel="noopener noreferrer">
          Discord
        </a>
      </p>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header() {
  const onPractice = route.value.startsWith('/practice')
  return (
    <header
      style={{
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid rgba(215,200,255,0.08)'
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 0,
          color: 'var(--ink)'
        }}
        aria-label="Elixir Drop home"
      >
        <span class="pl-elixir__drop" style={{ width: 14, height: 18 }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem' }}>Elixir Drop</span>
      </button>

      {onPractice && (
        <span class="pill pill--purple" style={{ marginLeft: 4 }}>
          Practice
        </span>
      )}
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
        <a
          href="https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg"
          target="_blank"
          rel="noopener noreferrer"
        >
          POAP KINGS
        </a>
      </div>
    </footer>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const r = route.value

  return (
    <>
      <Header />
      {r.startsWith('/practice') ? <Practice /> : <Home />}
      <Footer />
    </>
  )
}
