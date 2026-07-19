import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import rawCards from '@elixir-drop/game-data/cards.json'
import { route, navigate } from './lib/router'
import { track } from './lib/analytics'
import { accountError, accountStatus, initializeAccount, learning, player } from './lib/account'
import { gamePathForRoute, loginRouteForGame, profileRouteForGame, type GamePath } from './lib/game-routes'
import { ELIXIR_DROP_DISCORD_URL } from './lib/links'
import StarCount from './components/StarCount'
import PlayerAvatar from './components/PlayerAvatar'
import ApiStatusBanner from './components/ApiStatusBanner'
import Icon from './components/Icon'
import RunRecordingNotice from './components/RunRecordingNotice'
import Screensaver from './components/Screensaver'
import { createIdleWatcher, registerLogoTap, screensaverActive, startScreensaver } from './lib/screensaver'
import Login from './screens/Login'
import AuthRedeem from './screens/AuthRedeem'
import Profile from './screens/Profile'
import Leaderboards from './screens/Leaderboards'
import Privacy from './screens/Privacy'
import type { CardsData } from './types'

const POAP_KINGS = 'https://poapkings.com'
const CARD_COUNT = (rawCards as CardsData).cards.length

const loadPractice = () => import('./modes/practice/Practice')
const loadIdentify = () => import('./modes/identify/Identify')
const loadSurge = () => import('./modes/surge/Surge')
const loadHigherLower = () => import('./modes/higher-lower/HigherLower')
const loadTrade = () => import('./modes/trade/Trade')
const loadSpeedLadder = () => import('./modes/ladder/SpeedLadder')
const loadEndlessLadder = () => import('./modes/endless-ladder/EndlessLadder')
const loadCostSweep = () => import('./modes/cost-sweep/CostSweep')
const loadBlitz = () => import('./modes/blitz/Blitz')
const loadSurvival = () => import('./modes/survival/Survival')
const loadSettings = () => import('./modes/settings/Settings')
const loadAvatarAudit = () => import('./screens/AvatarAudit')

const Practice = lazy(loadPractice)
const Identify = lazy(loadIdentify)
const Surge = lazy(loadSurge)
const HigherLower = lazy(loadHigherLower)
const Trade = lazy(loadTrade)
const SpeedLadder = lazy(loadSpeedLadder)
const EndlessLadder = lazy(loadEndlessLadder)
const CostSweep = lazy(loadCostSweep)
const Blitz = lazy(loadBlitz)
const Survival = lazy(loadSurvival)
const SettingsScreen = lazy(loadSettings)
const AvatarAudit = import.meta.env.DEV ? lazy(loadAvatarAudit) : null

const ROUTE_PREFETCHERS: Record<string, () => Promise<unknown>> = {
  '/practice': loadPractice,
  '/identify': loadIdentify,
  '/surge': loadSurge,
  '/higher-lower': loadHigherLower,
  '/trade': loadTrade,
  '/ladder': loadSpeedLadder,
  '/endless-ladder': loadEndlessLadder,
  '/cost-sweep': loadCostSweep,
  '/blitz': loadBlitz,
  '/survival': loadSurvival,
  '/settings': loadSettings
}

const prefetchedRoutes = new Set<string>()

function prefetchRoute(path: string): void {
  const load = ROUTE_PREFETCHERS[path]
  if (!load || prefetchedRoutes.has(path)) return
  prefetchedRoutes.add(path)
  void load()
}

interface Mode {
  path: GamePath
  name: string
  icon: string
  desc: string
}

const GRID_MODES: Mode[] = [
  { path: '/practice', name: 'Practice', icon: '🎯', desc: 'Learn elixir costs at your own pace — no clock.' },
  { path: '/identify', name: 'Identify', icon: '🔎', desc: 'See the card art. Pick the right name.' },
  { path: '/higher-lower', name: 'Higher / Lower', icon: '⚖️', desc: 'Two cards — which one costs more?' },
  { path: '/trade', name: 'Trade', icon: '👑', desc: 'Read your elixir trade from Blue King side.' },
  { path: '/ladder', name: 'Speed Ladder', icon: '↕️', desc: 'Sort five cards from cheap to expensive.' },
  {
    path: '/endless-ladder',
    name: 'Endless Ladder',
    icon: '➕',
    desc: 'Insert each new card into the growing ladder.'
  },
  { path: '/cost-sweep', name: 'Cost Sweep', icon: '🧹', desc: 'Tap every card matching the target elixir cost.' },
  { path: '/blitz', name: 'Blitz', icon: '⏱️', desc: '60 seconds — how many can you clear?' },
  { path: '/survival', name: 'Survival', icon: '💀', desc: 'Sudden death — one miss ends the run.' }
]

// ── Home ──────────────────────────────────────────────────────────────────────

function GameCard({ m }: { m: Mode }) {
  return (
    <button
      class="game-card"
      onPointerEnter={() => prefetchRoute(m.path)}
      onFocus={() => prefetchRoute(m.path)}
      onClick={() => navigate(m.path)}
    >
      <span class="game-card__icon">{m.icon}</span>
      <span class="game-card__info">
        <span class="game-card__name">{m.name}</span>
        <span class="game-card__desc">{m.desc}</span>
      </span>
      <span class="game-card__arrow">
        <Icon name="arrow-right" />
      </span>
    </button>
  )
}

// The weakest well-sampled elixir band from the server's learning summary —
// the coach's one-line read that funnels players into focused Practice.
function weakCostBand(): { elixir: number; accuracyPct: number } | undefined {
  const summary = learning.value
  if (!summary) return undefined
  let weakest: { elixir: number; accuracyPct: number } | undefined
  for (const [cost, bucket] of Object.entries(summary.costAccuracy)) {
    if (bucket.seen < 10) continue
    const accuracyPct = Math.round((bucket.correct / bucket.seen) * 100)
    if (accuracyPct >= 85) continue
    if (!weakest || accuracyPct < weakest.accuracyPct) weakest = { elixir: Number(cost), accuracyPct }
  }
  return weakest
}

function Home() {
  const weakBand = accountStatus.value === 'authenticated' ? weakCostBand() : undefined
  return (
    <div class="home">
      <div class="hero">
        <div class="hero__inner">
          <h1 class="hero__title" onClick={() => registerLogoTap()}>
            <span class="t-elixir">ELIXIR</span>
            <span class="t-drop">DROP</span>
          </h1>
          <p class="hero__sub">Train your Clash Royale elixir instinct. Read the board faster. Win more trades.</p>
          <div class="hero__cta">
            <button
              class="btn btn--gold btn--lg"
              onPointerEnter={() => prefetchRoute('/surge')}
              onFocus={() => prefetchRoute('/surge')}
              onClick={() => navigate('/surge')}
            >
              ▶ Play Surge
            </button>
            <a class="btn btn--ghost btn--lg" href="#games">
              Browse games
            </a>
          </div>
          {accountStatus.value === 'anonymous' && (
            <button class="auth-nudge" onClick={() => navigate('/login')}>
              <strong>Sign in required to play</strong> · Every game counts toward your profile and the leaderboards
            </button>
          )}
          {accountStatus.value === 'unavailable' && (
            <button class="auth-nudge" onClick={() => void initializeAccount()}>
              <strong>Player services are reconnecting</strong> · Your saved login is still on this device
            </button>
          )}
          {weakBand && (
            <button class="coach-tile" data-testid="coach-tile" onClick={() => navigate('/practice')}>
              <Icon name="target" />
              <span>
                <strong>Coach's read:</strong> {weakBand.elixir}-elixir cards are your slow band ({weakBand.accuracyPct}
                %). Practice deals them to you.
              </span>
            </button>
          )}
        </div>
      </div>

      <div class="home__wrap">
        <div class="statstrip">
          <div class="statstrip__cell">
            <div class="statstrip__n">{CARD_COUNT}</div>
            <div class="statstrip__l">Cards in catalog</div>
          </div>
          <div class="statstrip__cell">
            <div class="statstrip__n">10</div>
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
                <button
                  class="btn btn--gold btn--lg"
                  onPointerEnter={() => prefetchRoute('/surge')}
                  onFocus={() => prefetchRoute('/surge')}
                  onClick={() => navigate('/surge')}
                >
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
  { match: '/identify', label: 'Identify' },
  { match: '/surge', label: 'Surge' },
  { match: '/higher-lower', label: 'Higher / Lower' },
  { match: '/trade', label: 'Trade' },
  { match: '/blitz', label: 'Blitz' },
  { match: '/survival', label: 'Survival' },
  { match: '/ladder', label: 'Speed Ladder' },
  { match: '/endless-ladder', label: 'Endless Ladder' },
  { match: '/cost-sweep', label: 'Cost Sweep' },
  { match: '/privacy', label: 'Privacy' }
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
      <button
        class="site-head__account"
        onClick={() => navigate(['authenticated', 'unavailable'].includes(accountStatus.value) ? '/profile' : '/login')}
      >
        {accountStatus.value === 'authenticated' && (
          <PlayerAvatar favoriteCardId={player.value?.favoriteCardId} size="small" />
        )}
        <span>
          {player.value?.publicName ||
            (accountStatus.value === 'authenticated'
              ? 'Player'
              : accountStatus.value === 'unavailable'
                ? 'Reconnecting…'
                : 'Sign in')}
        </span>
      </button>
      <button
        class="site-head__settings"
        onClick={() => navigate('/leaderboards')}
        aria-label="Leaderboards"
        title="Leaderboards"
      >
        ♛
      </button>
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
      <div class="site-foot__community">
        <span>Feedback, ideas, and game talk:</span>{' '}
        <a href={ELIXIR_DROP_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Join the Elixir Drop Discord <Icon name="arrow-right" />
        </a>
      </div>
      <div class="site-foot__run">
        Run by{' '}
        <a href={POAP_KINGS} target="_blank" rel="noopener noreferrer">
          POAP KINGS
        </a>
        <span aria-hidden="true"> · </span>
        <button class="site-foot__link" onClick={() => navigate('/privacy')}>
          Privacy
        </button>
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

function RouteFallback() {
  return (
    <div class="main-content route-loading" aria-live="polite">
      <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" aria-hidden="true" />
      <div class="route-loading__text">Loading game…</div>
    </div>
  )
}

function AuthRequired({ returnTo }: { returnTo: GamePath }) {
  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Player account required</div>
        <h1>Sign in to play</h1>
        <p class="lede">
          Every Elixir Drop game is recorded to your player profile and can count toward its seasonal leaderboard.
        </p>
        <button class="btn btn--gold" onClick={() => navigate(loginRouteForGame(returnTo))}>
          Sign in with email
        </button>
        <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
          Browse games
        </button>
      </div>
    </div>
  )
}

function ProfileRequired({ returnTo }: { returnTo: GamePath }) {
  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">One quick setup</div>
        <h1>Choose your player identity</h1>
        <p class="lede">Pick a favorite card and one of its generated names before your first recorded game.</p>
        <button class="btn btn--gold" onClick={() => navigate(profileRouteForGame(returnTo))}>
          Choose favorite card
        </button>
      </div>
    </div>
  )
}

function AccountUnavailable() {
  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" aria-hidden="true" />
        <div class="eyebrow">Login safely kept</div>
        <h1>Player services are reconnecting</h1>
        <p class="account-message account-message--error">
          {accountError.value || 'Drop could not reach player services.'}
        </p>
        <p class="lede">Your saved login has not been removed. Try again when your connection is ready.</p>
        <button class="btn btn--gold" onClick={() => void initializeAccount()}>
          Try reconnecting
        </button>
        <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    </div>
  )
}

function ScreenContent({ r }: { r: string }) {
  const gamePath = gamePathForRoute(r)
  if (gamePath && accountStatus.value === 'loading') return <RouteFallback />
  if ((gamePath || r.startsWith('/profile')) && accountStatus.value === 'unavailable') return <AccountUnavailable />
  if (gamePath && accountStatus.value !== 'authenticated') return <AuthRequired returnTo={gamePath} />
  if (gamePath && (!player.value?.favoriteCardId || !player.value.publicName)) {
    return <ProfileRequired returnTo={gamePath} />
  }
  if (import.meta.env.DEV && AvatarAudit && r.startsWith('/avatar-audit')) return <AvatarAudit />
  if (r.startsWith('/practice')) return <Practice />
  if (r.startsWith('/identify')) return <Identify />
  if (r.startsWith('/surge')) return <Surge />
  if (r.startsWith('/higher-lower')) return <HigherLower />
  if (r.startsWith('/trade')) return <Trade />
  if (r.startsWith('/blitz')) return <Blitz />
  if (r.startsWith('/survival')) return <Survival />
  if (r.startsWith('/ladder')) return <SpeedLadder />
  if (r.startsWith('/endless-ladder')) return <EndlessLadder />
  if (r.startsWith('/cost-sweep')) return <CostSweep />
  if (r.startsWith('/settings')) return <SettingsScreen />
  if (r.startsWith('/login')) return <Login />
  if (r.startsWith('/auth')) return <AuthRedeem />
  if (r.startsWith('/profile')) return <Profile />
  if (r.startsWith('/leaderboards')) return <Leaderboards />
  if (r.startsWith('/privacy')) return <Privacy />
  return <Home />
}

function Screen({ r }: { r: string }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <ScreenContent r={r} />
    </Suspense>
  )
}

function screenTitle(r: string): string | null {
  if (r === '/') return null
  return ROUTE_LABELS.find((x) => r.startsWith(x.match))?.label ?? 'Elixir Drop'
}

export default function App() {
  useEffect(() => {
    track('game.start')
    void initializeAccount()
  }, [])

  // Idle attract mode arms only on Home; leaving the route disarms it, so it
  // can never fire during a game. (Reading route.value in render subscribes
  // this component to the signal, so the local flag is a real dependency.)
  const onHome = route.value === '/'
  useEffect(() => {
    if (!onHome) return
    return createIdleWatcher(() => startScreensaver('idle'))
  }, [onHome])

  const title = screenTitle(route.value)

  return (
    <>
      <Header />
      <ApiStatusBanner />
      <main>
        {title && <h1 class="sr-only">{title}</h1>}
        <Screen r={route.value} />
      </main>
      <RunRecordingNotice />
      <Footer />
      {screensaverActive.value && <Screensaver />}
    </>
  )
}
