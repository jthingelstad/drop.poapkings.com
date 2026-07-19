import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { route, navigate } from './lib/router'
import { track } from './lib/analytics'
import { accountError, accountStatus, initializeAccount, player } from './lib/account'
import { gamePathForRoute, loginRouteForGame, profileRouteForGame, type GamePath } from './lib/game-routes'
import { ELIXIR_DROP_DISCORD_URL } from './lib/links'
import StarCount from './components/StarCount'
import PlayerAvatar from './components/PlayerAvatar'
import ApiStatusBanner from './components/ApiStatusBanner'
import Icon from './components/Icon'
import RunRecordingNotice from './components/RunRecordingNotice'
import Screensaver from './components/Screensaver'
import { createIdleWatcher, screensaverActive, startScreensaver } from './lib/screensaver'
import Home from './screens/Home'
import Login from './screens/Login'
import AuthRedeem from './screens/AuthRedeem'
import Profile from './screens/Profile'
import Leaderboards from './screens/Leaderboards'
import Privacy from './screens/Privacy'

const POAP_KINGS = 'https://poapkings.com'

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
  { match: '/leaderboards', label: 'Leaderboards' },
  { match: '/profile', label: 'Profile' },
  { match: '/settings', label: 'Settings' },
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
      <button class="site-head__leaderboards" onClick={() => navigate('/leaderboards')} aria-label="Leaderboards">
        <span aria-hidden="true">♛</span>
        <span class="site-head__leaderboards-full">Leaderboards</span>
        <span class="site-head__leaderboards-short">Boards</span>
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
