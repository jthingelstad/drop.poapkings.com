import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { route, navigate } from './lib/router'
import { accountError, accountStatus, initializeAccount, player } from './lib/account'
import { gamePathForRoute } from './lib/game-routes'
import UpdateBanner from './components/UpdateBanner'
import { getStats } from './lib/api'
import { checkForWebUpdate, isUpdateNoticeEnabled, updateAvailable } from './lib/version'
import RunRecordingNotice from './components/RunRecordingNotice'
import BadgeCelebration from './components/BadgeCelebration'
import ChargeRing from './components/ChargeRing'
import GateCard from './components/GateCard'
import RankedTouchGate from './components/RankedTouchGate'
import Screensaver from './components/Screensaver'
import { createIdleWatcher, screensaverActive, startScreensaver } from './lib/screensaver'
import { initInstallPrompt } from './lib/pwa-install'
import { apiAvailability, offline, watchConnectivity } from './lib/api-availability'
import { cacheAppShell, initCardArtCache } from './lib/card-art-cache'
import { layout, isRankedTouchGate } from './lib/use-layout'
import MobileShell from './components/shell/MobileShell'
import Home from './screens/Home'
import Login from './screens/Login'
import AuthRedeem from './screens/AuthRedeem'
import Profile from './screens/Profile'
import PublicProfile from './screens/PublicProfile'
import Leaderboards from './screens/Leaderboards'
import AppInfo from './screens/AppInfo'
import GameStartScreen from './components/game/GameStart'
import Icon from './components/Icon'
import { GAMES } from './lib/game-metadata'
import { practiceEntryPath } from './lib/practice-navigation'

// The six shipped modes, each lazy-loaded as its own route chunk.
const loadPractice = () => import('./modes/practice/Practice')
const loadSurge = () => import('./modes/surge/Surge')
const loadHigherLower = () => import('./modes/higher-lower/HigherLower')
const loadTrade = () => import('./modes/trade/Trade')
const loadSurvival = () => import('./modes/survival/Survival')
const loadRain = () => import('./modes/rain/Rain')
const loadAvatarAudit = () => import('./screens/AvatarAudit')

const loadOfflineGames = () =>
  Promise.all([loadPractice(), loadSurge(), loadHigherLower(), loadTrade(), loadSurvival(), loadRain()])

const Practice = lazy(loadPractice)
const Surge = lazy(loadSurge)
const HigherLower = lazy(loadHigherLower)
const Trade = lazy(loadTrade)
const Survival = lazy(loadSurvival)
const Rain = lazy(loadRain)
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
  { match: '/leaderboards', label: 'Ladder' },
  { match: '/profile', label: 'You' },
  { match: '/players', label: 'Player profile' },
  { match: '/settings', label: 'You' },
  { match: '/app-info', label: 'App info' },
  { match: '/login', label: 'Sign in' },
  { match: '/auth', label: 'Signing in' }
]

// ── App ───────────────────────────────────────────────────────────────────────

function RouteFallback({ r }: { r: string }) {
  const gamePath = gamePathForRoute(r)
  const game = gamePath ? GAMES.find((candidate) => candidate.path === gamePath) : undefined
  if (game) return <GameStartScreen modeName={game.name} phase="preparing" routePending />

  // No screen exists yet for this route chunk, so the charge ring IS the screen —
  // the same 172px gold slot the countdown numeral will land in.
  return (
    <div class="main-content route-loading">
      <ChargeRing />
    </div>
  )
}

function RankedAccessRestricted() {
  return (
    <div class="main-content">
      <GateCard
        mark={<Icon name="shield" />}
        state="Ranked restricted"
        primary={{ label: 'Open Practice', onAction: () => navigate(practiceEntryPath()) }}
        secondary={{ label: 'Read Fair Play', href: '/fair-play/' }}
      >
        You can still use Practice and view your account. Fair Play explains how decisions work and how to request a
        re-review.
      </GateCard>
    </div>
  )
}

function AccountUnavailable() {
  return (
    <div class="main-content" aria-live="polite">
      <GateCard
        mark={<ChargeRing variant="reconnecting" />}
        state="Reconnecting"
        primary={{ label: 'Try reconnecting', onAction: () => void initializeAccount() }}
        secondary={{ label: 'Back to home', onAction: () => navigate('/') }}
      >
        {accountError.value || 'Drop could not reach player services.'} Your saved login has not been removed.
      </GateCard>
    </div>
  )
}

function HomeRedirect() {
  useEffect(() => navigate('/'), [])
  return <Home />
}

function ScreenContent({ r }: { r: string }) {
  if (r === '/practice' && layout.value === 'mobile') return <HomeRedirect />
  const gamePath = gamePathForRoute(r)
  // Offline, the player stays on the real page they asked for: it names its cause
  // with a header chip and shows what it has, never a takeover. The Ladder and You
  // are live views that go quiet offline, not offline destinations — so the bundled
  // /offline explainer is retired; a legacy link to it lands Home.
  if (r.startsWith('/offline')) return <HomeRedirect />
  // An offline game is local and unrecorded, so account state cannot gate it.
  // The effective state covers both a transport disconnect and an unreachable
  // player API; either way there is no official run to protect or record.
  const gameWithoutServices = Boolean(gamePath) && offline.value
  if (gamePath && !gameWithoutServices && accountStatus.value === 'loading') return <RouteFallback r={r} />
  if ((gamePath || r.startsWith('/profile')) && !gameWithoutServices && accountStatus.value === 'unavailable')
    return <AccountUnavailable />
  // Identity never blocks a run: profile setup fires when the magic link lands
  // (screens/Profile identity steps), not when a game starts, so a signed-in
  // player who has not finished setup still plays — the run records under their
  // account and identity is filled in on the You page.
  if (gamePath && !gameWithoutServices && gamePath !== '/practice' && player.value?.rankedAccess === 'restricted') {
    return <RankedAccessRestricted />
  }
  // Ranked play is touch-only (fair millisecond timing), independent of the
  // width breakpoint and of connectivity — a mouse-only device never starts a
  // ranked run, online or offline. Practice ('/practice') is exempt and stays
  // open everywhere.
  if (isRankedTouchGate(r) && gamePath) return <RankedTouchGate path={gamePath} />
  if (import.meta.env.DEV && AvatarAudit && r.startsWith('/avatar-audit')) return <AvatarAudit />
  if (r.startsWith('/practice')) return <Practice />
  if (r.startsWith('/surge')) return <Surge />
  if (r.startsWith('/higher-lower')) return <HigherLower />
  if (r.startsWith('/trade')) return <Trade />
  if (r.startsWith('/survival')) return <Survival />
  if (r.startsWith('/rain')) return <Rain />
  // Settings moved into the You page (a scope). Legacy /settings links land there.
  if (r.startsWith('/settings')) return <Profile />
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
      <Screen r={route.value} />
    </>
  )

  return (
    <>
      <MobileShell>{content}</MobileShell>
      <RunRecordingNotice />
      {/* Interrupt ladder overlays — the ladder gate lets at most one show. The
          tier-4 update strip sits above the nav pill (no scrim); the tier-1 badge
          celebration is the only full takeover, and only on a summary. */}
      <UpdateBanner />
      <BadgeCelebration />
      {screensaverActive.value && <Screensaver />}
    </>
  )
}
