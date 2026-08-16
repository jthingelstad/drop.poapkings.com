import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { route, navigate } from './lib/router'
import { accountError, accountStatus, initializeAccount, player } from './lib/account'
import { gamePathForRoute, profileRouteForGame, type GamePath } from './lib/game-routes'
import UpdateBanner from './components/UpdateBanner'
import { getStats } from './lib/api'
import { checkForWebUpdate, isUpdateNoticeEnabled, updateAvailable } from './lib/version'
import RunRecordingNotice from './components/RunRecordingNotice'
import ReleaseNotice from './components/ReleaseNotice'
import PlayerTagNudge from './components/PlayerTagNudge'
import Screensaver from './components/Screensaver'
import { createIdleWatcher, screensaverActive, startScreensaver } from './lib/screensaver'
import { initInstallPrompt } from './lib/pwa-install'
import { apiAvailability, offline, watchConnectivity } from './lib/api-availability'
import { cacheAppShell, initCardArtCache } from './lib/card-art-cache'
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
import AppInfo from './screens/AppInfo'
import Icon from './components/Icon'
import OfflinePage from './components/OfflinePage'
import GameStartScreen from './components/game/GameStart'
import { GAMES } from './lib/game-metadata'
import { contactEmailHref } from './lib/links'
import { practiceLandingPath } from './lib/practice-navigation'

// The six shipped modes, each lazy-loaded as its own route chunk.
const loadPractice = () => import('./modes/practice/Practice')
const loadSurge = () => import('./modes/surge/Surge')
const loadHigherLower = () => import('./modes/higher-lower/HigherLower')
const loadTrade = () => import('./modes/trade/Trade')
const loadSurvival = () => import('./modes/survival/Survival')
const loadRain = () => import('./modes/rain/Rain')
const loadSettings = () => import('./modes/settings/Settings')
const loadAvatarAudit = () => import('./screens/AvatarAudit')

const loadOfflineGames = () =>
  Promise.all([loadPractice(), loadSurge(), loadHigherLower(), loadTrade(), loadSurvival(), loadRain()])

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
  { match: '/offline', label: 'Offline' },
  { match: '/leaderboards', label: 'Leaderboards' },
  { match: '/profile', label: 'Profile' },
  { match: '/players', label: 'Player profile' },
  { match: '/settings', label: 'Settings' },
  { match: '/app-info', label: 'App info' },
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

function RankedAccessRestricted() {
  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Fair Play decision</div>
        <h1>Ranked access restricted</h1>
        <p class="lede">
          You can still use Practice and view your account. Read how decisions work or request a re-review.
        </p>
        <button class="btn btn--gold" onClick={() => navigate(practiceLandingPath())}>
          Open Practice
        </button>
        <a class="btn btn--ghost btn--sm" href="/fair-play/">
          Read Fair Play
        </a>
        <a class="btn btn--ghost btn--sm" href={contactEmailHref('Elixir Drop ranked-access re-review')}>
          Request re-review
        </a>
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

function MobilePracticeRedirect() {
  useEffect(() => navigate('/'), [])
  return <Home />
}

function ScreenContent({ r }: { r: string }) {
  if (r === '/practice' && layout.value === 'mobile') return <MobilePracticeRedirect />
  const gamePath = gamePathForRoute(r)
  // These are live server views, not snapshots. Offline navigation replaces
  // both with one bundled explanation; direct links land on the same surface
  // instead of a failed request, stale board, or account reconnect spinner.
  if (r.startsWith('/offline')) return <OfflinePage />
  if (offline.value && (r.startsWith('/leaderboards') || r.startsWith('/profile'))) return <OfflinePage />
  // An offline game is local and unrecorded, so account state cannot gate it.
  // The effective state covers both a transport disconnect and an unreachable
  // player API; either way there is no official run to protect or record.
  const gameWithoutServices = Boolean(gamePath) && offline.value
  if (gamePath && !gameWithoutServices && accountStatus.value === 'loading') return <RouteFallback r={r} />
  if ((gamePath || r.startsWith('/profile')) && !gameWithoutServices && accountStatus.value === 'unavailable')
    return <AccountUnavailable />
  // A signed-OUT visitor plays as a guest (nothing recorded); only a signed-IN
  // player who has not finished profile setup is routed to it first.
  if (
    gamePath &&
    !gameWithoutServices &&
    accountStatus.value === 'authenticated' &&
    (!player.value?.favoriteCardId || !player.value.publicName)
  ) {
    return <ProfileRequired returnTo={gamePath} />
  }
  if (gamePath && !gameWithoutServices && gamePath !== '/practice' && player.value?.rankedAccess === 'restricted') {
    return <RankedAccessRestricted />
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
  if (r.startsWith('/app-info')) return <AppInfo />
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
  if (r === '/' || (r === '/practice' && layout.value === 'mobile')) return null
  return ROUTE_LABELS.find((x) => r.startsWith(x.match))?.label ?? 'Elixir Drop'
}

export default function App() {
  useEffect(() => {
    void initializeAccount()
    initInstallPrompt()
    // Every game is a lazy route, so none of their chunks are guaranteed to be
    // in the document's script list. Warm all six through the active worker,
    // then atomically commit the shell that makes every mode open offline.
    void initCardArtCache().then(async (worker) => {
      try {
        await loadOfflineGames()
        // Commit the new shell only after every lazy game graph has loaded
        // through this worker. The worker keeps the prior complete build until
        // every URL in this message is safely cached.
        if (worker) cacheAppShell(worker)
      } catch {
        // A later online load retries the warm-up. The worker deliberately
        // keeps the prior complete shell when this build could not finish.
      }
    })
    // Decides once per load whether a named release is worth announcing. A
    // first-time visitor is recorded and never interrupted.
    initReleaseNotice()
    return watchConnectivity()
  }, [])

  // API outages are an ordinary offline experience now, with no error banner
  // or manual retry loop. Probe conservatively in the background so returning
  // to the app, restoring transport, or leaving it open can restore connected
  // navigation without a reload. Do not probe immediately: the request that
  // changed availability has already established the outage.
  const apiOutage = apiAvailability.value === 'unavailable'
  useEffect(() => {
    if (!apiOutage) return
    let checking = false
    let disposed = false
    const check = async () => {
      if (checking || navigator.onLine === false || document.visibilityState !== 'visible') return
      checking = true
      try {
        await getStats()
        if (!disposed && accountStatus.value === 'unavailable') await initializeAccount()
      } catch {
        // The shared availability signal keeps the app offline until a probe
        // succeeds. There is deliberately no player-facing error or retry UI.
      } finally {
        checking = false
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    const onFocus = () => void check()
    const onOnline = () => void check()
    const timer = window.setInterval(() => void check(), 30_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [apiOutage])

  // Watch Pages for a newer front-end build. A startup check, periodic poll,
  // and refocus check catch a stale installed PWA without coupling this signal
  // to player API availability. Stops polling once an update is known.
  useEffect(() => {
    if (!isUpdateNoticeEnabled()) return
    const check = () => {
      if (updateAvailable.value || document.visibilityState !== 'visible') return
      void checkForWebUpdate()
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
  const onHome = route.value === '/' || (route.value === '/practice' && layout.value === 'mobile')
  useEffect(() => {
    if (!onHome) return
    return createIdleWatcher(() => startScreensaver('idle'))
  }, [onHome])

  const title = screenTitle(route.value)
  useEffect(() => {
    document.title = title ? `${title} | Elixir Drop` : 'Elixir Drop — Clash Royale Elixir Cost Trainer'
  }, [title])

  // Same routes + data on both layouts; only the surrounding shell differs. The
  // shell is chosen at the 1024px breakpoint (lib/use-layout) and re-evaluated
  // on resize. The old global footer (Discord + fan-content disclaimer) has moved
  // into standalone text pages — About carries the disclaimer, while Discord
  // and the real HTML pages remain reachable from both shells.
  const content = (
    <>
      {title && <h1 class="sr-only">{title}</h1>}
      <UpdateBanner />
      <Screen r={route.value} />
    </>
  )

  return (
    <>
      {layout.value === 'desktop' ? <DesktopShell>{content}</DesktopShell> : <MobileShell>{content}</MobileShell>}
      <RunRecordingNotice />
      <ReleaseNotice />
      <PlayerTagNudge />
      {screensaverActive.value && <Screensaver />}
    </>
  )
}
