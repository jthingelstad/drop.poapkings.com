import { player } from '../lib/account'
import { gamePathForRoute, loginRouteForGame } from '../lib/game-routes'
import { navigate, route } from '../lib/router'

// After a guest run finishes, invite the signed-out player to sign in before
// the next run. Guest results are intentionally never promoted retroactively.
// `variant='line'` is a lightweight one-liner for modes with no summary screen
// (Higher/Lower); the default is the fuller panel used on result screens.
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
    <div class="competition-panel competition-panel--join signin-save">
      <p>Sign in before your next game to save future scores and compete on the leaderboard.</p>
      <button class="btn btn--gold" onClick={() => navigate(signInRoute)}>
        Sign In
      </button>
    </div>
  )
}
