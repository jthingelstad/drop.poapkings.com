import { player } from '../lib/account'
import { offline } from '../lib/api-availability'
import { gamePathForRoute, loginRouteForGame } from '../lib/game-routes'
import { navigate, route } from '../lib/router'
import GateCard from './GateCard'
import Icon from './Icon'

// After a guest run finishes, invite the signed-out player to sign in before
// the next run. Guest results are intentionally never promoted retroactively.
// `variant='line'` is a lightweight one-liner for modes with no summary screen
// (Higher/Lower); the default is the shared gate card used on result screens.
// Sign-in cannot complete offline, so the primary is only live when connected.
export default function SignInToSave({ variant = 'panel' }: { variant?: 'panel' | 'line' }) {
  if (player.value) return null
  const gamePath = gamePathForRoute(route.value)
  const signInRoute = gamePath ? loginRouteForGame(gamePath) : '/login'

  if (variant === 'line') {
    return (
      <button class="signin-save signin-save--line" onClick={() => navigate(signInRoute)}>
        Sign in before your next game to save future scores
      </button>
    )
  }

  return (
    <GateCard
      mark={<Icon name="trophy" />}
      state="Guest run"
      primary={{ label: 'Sign in', onAction: () => navigate(signInRoute), disabled: offline.value }}
    >
      Sign in before your next game to save future scores and compete on the leaderboard.
    </GateCard>
  )
}
