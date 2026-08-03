import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { route, navigate } from './lib/router'
import { accountError, accountStatus, initializeAccount, player } from './lib/account'
import { gamePathForRoute, profileRouteForGame, type GamePath } from './lib/game-routes'
import ApiStatusBanner from './components/ApiStatusBanner'
import UpdateBanner from './components/UpdateBanner'
import { getStats } from './lib/api'
import { isUpdateNoticeEnabled, updateAvailable } from './lib/version'
import RunRecordingNotice from './components/RunRecordingNotice'
import ReleaseNotice from './components/ReleaseNotice'
import Screensaver from './components/Screensaver'
import { createIdleWatcher, screensaverActive, startScreensaver } from './lib/screensaver'
import { initInstallPrompt } from './lib/pwa-install'
import { initReleaseNotice } from './lib/release-notice'
import { layout } from './lib/use-layout'
import MobileShell from './components/shell/MobileShell'
import DesktopShell from './components/shell/DesktopShell'
import Home from './screens/Home'
import Login from './screens/Login'
import AuthRedeem from './screens/AuthRedeem'
import Profile from './screens/Profile'
import PublicProfile from './screens/PublicProfile'
import Leaderboards from './screens/Leaderboards'
import Privacy from './screens/Privacy'
import MetaPage from './screens/MetaPage'
import Icon from './components/Icon'
import GameStartScreen from './components/game/GameStart'
import { GAMES } from './lib/game-metadata'

// The six shipped modes, each lazy-loaded as its own route chunk.
const loadPractice = () => import('./modes/practice/Practice')
const loadSurge = () => import('./modes/surge/Surge')
const loadHigherLower = () => import('./modes/higher-lower/HigherLower')
const loadTrade = () => import('./modes/trade/Trade')
const loadSurvival = () => import('./modes/survival/Survival')
const loadRain = () => import('./modes/rain/Rain')
const loadSettings = () => import('./modes/settings/Settings')
const loadAvatarAudit = () => import('./screens/AvatarAudit')

const Practice = lazy(loadPractice)
const Surge = lazy(loadSurge)
const HigherLower = lazy(loadHigherLower)
const Trade = lazy(loadTrade)
const Survival = lazy(loadSurvival)
const Rain = lazy(loadRain)
const SettingsScreen = lazy(loadSettings)
const AvatarAudit = import.meta.env.DEV ? lazy(loadAvatarAudit) : null

// ── Screen title (sr-only) ──────────────────────────────────────────────────

// One entry per routed path in ScreenContent below (the dev-only avatar audit
// aside). A missing entry is not harmless: the route silently announces the
// generic "Elixir Drop" as its page heading.
const ROUTE_LABELS: { match: string; label: string }[] = [
  { match: '/practice', label: 'Practice' },
  { match: '/surge', label: 'Surge' },
  { match: '/higher-lower', label: 'Higher / Lower' },
  { match: '/trade', label: 'Trade' },
  { match: '/survival', label: 'Survival' },
  { match: '/rain', label: 'Rain' },
  { match: '/leaderboards', label: 'Leaderboards' },
  { match: '/profile', label: 'Profile' },
  { match: '/players', label: 'Player profile' },
  { match: '/settings', label: 'Settings' },
  { match: '/privacy', label: 'Privacy' },
  { match: '/about', label: 'About' },
  { match: '/releases', label: 'Releases' },
  { match: '/faq', label: 'FAQ' },
  { match: '/install', label: 'Install' },
  { match: '/login', label: 'Sign in' },
  { match: '/auth', label: 'Signing in' }
]

// ── App ───────────────────────────────────────────────────────────────────────

function RouteFallback({ r }: { r: string }) {
  const gamePath = gamePathForRoute(r)
  const game = gamePath ? GAMES.find((candidate) => candidate.path === gamePath) : undefined
  if (game) return <GameStartScreen modeName={game.name} phase="preparing" routePending />

  return (
    <div class="main-content route-loading" aria-live="polite">
      <Icon name="loader-circle" className="route-loading__spinner" />
      <div class="route-loading__text">Loading game…</div>
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
        <Icon name="loader-circle" className="route-loading__spinner" />
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
  if (gamePath && accountStatus.value === 'loading') return <RouteFallback r={r} />
  if ((gamePath || r.startsWith('/profile')) && accountStatus.value === 'unavailable') return <AccountUnavailable />
  // A signed-OUT visitor plays as a guest (nothing recorded); only a signed-IN
  // player who has not finished profile setup is routed to it first.
  if (
    gamePath &&
    accountStatus.value === 'authenticated' &&
    (!player.value?.favoriteCardId || !player.value.publicName)
  ) {
    return <ProfileRequired returnTo={gamePath} />
  }
  if (import.meta.env.DEV && AvatarAudit && r.startsWith('/avatar-audit')) return <AvatarAudit />
  if (r.startsWith('/practice')) return <Practice />
  if (r.startsWith('/surge')) return <Surge />
  if (r.startsWith('/higher-lower')) return <HigherLower />
  if (r.startsWith('/trade')) return <Trade />
  if (r.startsWith('/survival')) return <Survival />
  if (r.startsWith('/rain')) return <Rain />
  if (r.startsWith('/settings')) return <SettingsScreen />
  if (r.startsWith('/login')) return <Login />
  if (r.startsWith('/auth')) return <AuthRedeem />
  if (r.startsWith('/players/')) return <PublicProfile />
  if (r.startsWith('/profile')) return <Profile />
  if (r.startsWith('/leaderboards')) return <Leaderboards />
  if (r.startsWith('/privacy')) return <Privacy />
  if (r.startsWith('/about')) return <MetaPage kind="about" />
  if (r.startsWith('/releases')) return <MetaPage kind="releases" />
  if (r.startsWith('/faq')) return <MetaPage kind="faq" />
  if (r.startsWith('/install')) return <MetaPage kind="install" />
  return <Home />
}

function Screen({ r }: { r: string }) {
  return (
    <Suspense fallback={<RouteFallback r={r} />}>
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
    void initializeAccount()
    initInstallPrompt()
    // Decides once per load whether a named release is worth announcing. A
    // first-time visitor is recorded and never interrupted.
    initReleaseNotice()
  }, [])

  // Watch for a newer front-end build: /stats reports the current version, so a
  // check at startup, periodic poll, and refocus check catch a stale installed
  // PWA and let the player reload. Stops polling once an update is known.
  useEffect(() => {
    if (!isUpdateNoticeEnabled()) return
    const check = () => {
      if (updateAvailable.value || document.visibilityState !== 'visible') return
      void getStats().catch(() => {})
    }
    check()
    const timer = window.setInterval(check, 15 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
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

  // Same routes + data on both layouts; only the surrounding shell differs. The
  // shell is chosen at the 1024px breakpoint (lib/use-layout) and re-evaluated
  // on resize. The old global footer (Discord + fan-content disclaimer) has moved
  // into the meta pages — About carries the disclaimer, Discord/Privacy/About/FAQ
  // are reachable from Profile → More (mobile) and the left-rail cluster (desktop).
  const content = (
    <>
      {title && <h1 class="sr-only">{title}</h1>}
      <ApiStatusBanner />
      <UpdateBanner />
      <Screen r={route.value} />
    </>
  )

  return (
    <>
      {layout.value === 'desktop' ? <DesktopShell>{content}</DesktopShell> : <MobileShell>{content}</MobileShell>}
      <RunRecordingNotice />
      <ReleaseNotice />
      {screensaverActive.value && <Screensaver />}
    </>
  )
}
