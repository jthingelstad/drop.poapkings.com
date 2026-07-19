import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { route, navigate } from './lib/router'
import { track } from './lib/analytics'
import { accountError, accountStatus, initializeAccount, player } from './lib/account'
import { gamePathForRoute, loginRouteForGame, profileRouteForGame, type GamePath } from './lib/game-routes'
import { ELIXIR_DROP_DISCORD_URL } from './lib/links'
import PlayerAvatar from './components/PlayerAvatar'
import { rankFor } from './data/starRanks'
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

// The launch five. Identify, Speed Ladder, Endless Ladder, Cost Sweep, and
// Blitz are vaulted — components retained under src/modes/ for re-release
// drops (GAMES.md "Vaulted for launch"), but unrouted and unbundled.
const loadPractice = () => import('./modes/practice/Practice')
const loadSurge = () => import('./modes/surge/Surge')
const loadHigherLower = () => import('./modes/higher-lower/HigherLower')
const loadTrade = () => import('./modes/trade/Trade')
const loadSurvival = () => import('./modes/survival/Survival')
const loadSettings = () => import('./modes/settings/Settings')
const loadAvatarAudit = () => import('./screens/AvatarAudit')

const Practice = lazy(loadPractice)
const Surge = lazy(loadSurge)
const HigherLower = lazy(loadHigherLower)
const Trade = lazy(loadTrade)
const Survival = lazy(loadSurvival)
const SettingsScreen = lazy(loadSettings)
const AvatarAudit = import.meta.env.DEV ? lazy(loadAvatarAudit) : null

// ── Header ────────────────────────────────────────────────────────────────────

const ROUTE_LABELS: { match: string; label: string }[] = [
  { match: '/practice', label: 'Practice' },
  { match: '/surge', label: 'Surge' },
  { match: '/higher-lower', label: 'Higher / Lower' },
  { match: '/trade', label: 'Trade' },
  { match: '/survival', label: 'Survival' },
  { match: '/leaderboards', label: 'Leaderboards' },
  { match: '/profile', label: 'Profile' },
  { match: '/settings', label: 'Settings' },
  { match: '/privacy', label: 'Privacy' }
]

// The player block: activity score (XP), profile card, and arena badge — a
// single tap target into the profile. Signed out, it becomes a sign-in glyph.
function PlayerBlock() {
  const current = player.value
  if (!current) {
    const reconnecting = accountStatus.value === 'unavailable'
    return (
      <button
        class="site-head__signin"
        onClick={() => navigate(reconnecting ? '/profile' : '/login')}
        aria-label={reconnecting ? 'Reconnecting' : 'Sign in'}
        title={reconnecting ? 'Reconnecting…' : 'Sign in'}
      >
        <Icon name="log-in" />
        <span class="site-head__signin-label">{reconnecting ? 'Reconnecting…' : 'Sign in'}</span>
      </button>
    )
  }
  const xp = current.xp ?? 0
  const arena = rankFor(xp).current
  return (
    <button
      class="player-block"
      onClick={() => navigate('/profile')}
      aria-label={`Your profile — ${xp.toLocaleString()} XP, ${arena.name} arena`}
      title={`${xp.toLocaleString()} XP · ${arena.name}`}
    >
      <span class="player-block__xp">
        <Icon name="zap" />
        {xp.toLocaleString()}
      </span>
      <PlayerAvatar favoriteCardId={current.favoriteCardId} size="small" />
      <img class="player-block__arena" src={arena.image} alt="" aria-hidden="true" />
    </button>
  )
}

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

      <PlayerBlock />

      <button
        class="site-head__icon"
        onClick={() => navigate('/leaderboards')}
        aria-label="Leaderboards"
        title="Leaderboards"
      >
        <Icon name="trophy" />
      </button>
      <button class="site-head__icon" onClick={() => navigate('/settings')} aria-label="Settings" title="Settings">
        <Icon name="settings" />
      </button>
      <button
        class="site-head__icon"
        onClick={() => startScreensaver('nav')}
        aria-label="Play the screensaver"
        title="Screensaver"
      >
        <Icon name="sparkles" />
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
  if (r.startsWith('/surge')) return <Surge />
  if (r.startsWith('/higher-lower')) return <HigherLower />
  if (r.startsWith('/trade')) return <Trade />
  if (r.startsWith('/survival')) return <Survival />
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
