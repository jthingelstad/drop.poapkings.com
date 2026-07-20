import { player } from '../lib/account'
import { navigate } from '../lib/router'

// After a guest run finishes, invite the signed-out player to create an account
// so the score can be saved to the leaderboard. Renders nothing when signed in.
// `variant='line'` is a lightweight one-liner for modes with no summary screen
// (Higher/Lower); the default is the fuller panel used on result screens.
export default function SignInToSave({ variant = 'panel' }: { variant?: 'panel' | 'line' }) {
  if (player.value) return null

  if (variant === 'line') {
    return (
      <button class="signin-save signin-save--line" onClick={() => navigate('/login')}>
        Sign in to save your streak
      </button>
    )
  }

  return (
    <div class="competition-panel competition-panel--join signin-save">
      <p>Create an account to save this score to the leaderboard — forever.</p>
      <button class="btn btn--gold" onClick={() => navigate('/login')}>
        Sign in to save
      </button>
    </div>
  )
}
