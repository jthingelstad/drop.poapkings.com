import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { pollLogin } from '../lib/api'
import { applyPolledSession, beginElixirLogin, clearPendingElixirLogin, pendingElixirLogin } from '../lib/account'
import { authReturnPathFromRoute } from '../lib/game-routes'
import { navigate, route, routeQuery } from '../lib/router'

// A Drop account is an Elixir account (2026-10-12): this screen offers one
// way in, Sign in with Elixir. Guests still play every game without one.

// What Elixir's door said when it sent the person back without a session.
// The codes are the API's (services/api/src/routes/elixir-auth.ts).
const ELIXIR_ERRORS: Record<string, string> = {
  not_a_person: 'That was an agent connection, not yours. Sign in to Elixir as yourself.',
  login_expired: 'That Elixir sign-in took too long or was already used. Start again.',
  missing_code: 'Elixir sent you back without a code. Start again.',
  wrong_issuer: 'That code did not come from Elixir. Start again.',
  invalid_grant: 'Elixir would not accept that sign-in. Start again.',
  insufficient_scope: 'Elixir did not share your email, so Drop cannot tell who you are. Allow it on the consent page.',
  email_unavailable:
    'Your Elixir account has no email on file yet. Sign in to elixir.poapkings.com once, then try again.',
  elixir_account_in_use:
    'That Elixir account already signs in to a different Drop account. Sign out and sign in with Elixir to reach it.',
  elixir_account_mismatch: 'This Drop account belongs to a different Elixir account. Sign in with that one.',
  transport: 'Elixir did not answer. Try again in a minute.',
  elixir_unavailable: 'Elixir did not answer. Try again in a minute.'
}

export default function Login() {
  const returnTo = authReturnPathFromRoute(route.value)
  const elixirStatus = useSignal<'idle' | 'starting' | 'waiting'>('idle')
  const elixirError = useSignal(ELIXIR_ERRORS[new URLSearchParams(routeQuery(route.value)).get('elixir') ?? ''] ?? '')

  // Back on this screen with an Elixir sign-in in flight: the consent may
  // have finished in another browsing context (an installed PWA on iOS opens
  // the chain in an in-app view), so poll for the session it handed off.
  useEffect(() => {
    const pending = pendingElixirLogin()
    if (!pending || elixirError.value) return
    elixirStatus.value = 'waiting'
    const controller = new AbortController()
    const deadline = pending.startedAt + 15 * 60_000
    let timer = 0
    let stopped = false
    const tick = async () => {
      if (stopped || Date.now() > deadline) return
      try {
        const result = await pollLogin(pending.pollId, controller.signal)
        if (result.ready) {
          stopped = true
          clearPendingElixirLogin()
          await applyPolledSession(result.session)
          navigate(pending.returnTo || '/profile?scope=account')
          return
        }
      } catch {
        // transient — keep polling
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), 2500)
    }
    timer = window.setTimeout(() => void tick(), 1500)
    return () => {
      stopped = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only poll for a sign-in already in flight

  async function signInWithElixir() {
    if (elixirStatus.value === 'starting') return
    elixirStatus.value = 'starting'
    elixirError.value = ''
    try {
      await beginElixirLogin(returnTo)
    } catch (error) {
      elixirStatus.value = 'idle'
      elixirError.value = error instanceof Error ? error.message : 'Sign in with Elixir is not available right now.'
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Player account</div>
        <h1>Sign In</h1>
        <p class="lede">
          A Drop account is an{' '}
          <a class="text-link" href="https://elixir.poapkings.com/" rel="noreferrer">
            Elixir
          </a>{' '}
          account. Sign in with Elixir to keep your scores, XP, and badges. No password, and no Clash Royale account
          access.
        </p>
        <div class="account-elixir">
          <button
            type="button"
            class="btn btn--gold account-elixir__btn"
            disabled={elixirStatus.value !== 'idle'}
            onClick={() => void signInWithElixir()}
          >
            {elixirStatus.value === 'waiting'
              ? 'Waiting for Elixir…'
              : elixirStatus.value === 'starting'
                ? 'Opening Elixir…'
                : 'Sign in with Elixir'}
          </button>
          {elixirError.value && (
            <div class="account-message account-message--error" role="alert">
              {elixirError.value}
            </div>
          )}
        </div>
        <p class="account-privacy">
          Choose which of your players Drop shows, and a player Elixir has verified gets the same checkmark here. Your
          email stays private and is used for sign-in plus occasional Drop release news. Your chosen player name,
          favorite card, scores, and optional public Clash Royale tag appear in Drop.{' '}
          <a class="text-link" href="/privacy/">
            Privacy details
          </a>
        </p>
        <p class="account-privacy">Every game plays without an account, as a guest; guest runs are not saved.</p>
        <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    </div>
  )
}
