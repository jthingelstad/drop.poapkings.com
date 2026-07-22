import { useSignal } from '@preact/signals'
import { redeemAccount } from '../lib/account'
import { gameReturnPathFromRoute, profileRouteForGame } from '../lib/game-routes'
import { navigate, route } from '../lib/router'
import { flushLoginCompleted, queueLoginCompleted } from '../lib/analytics'

export default function AuthRedeem() {
  const error = useSignal('')
  const redeeming = useSignal(false)

  const query = route.value.split('?')[1] || ''
  const token = new URLSearchParams(query).get('token')
  const returnTo = gameReturnPathFromRoute(route.value)

  // Redemption waits for a real click: mail-security scanners follow and
  // execute login links, and an auto-redeeming page let them burn the
  // single-use token before the player ever saw the tab.
  async function redeem() {
    if (!token || redeeming.value) return
    redeeming.value = true
    error.value = ''
    try {
      const authenticatedPlayer = await redeemAccount(token)
      queueLoginCompleted()
      if (!authenticatedPlayer.favoriteCardId || !authenticatedPlayer.publicName) {
        navigate(returnTo ? profileRouteForGame(returnTo) : '/profile')
        flushLoginCompleted()
        return
      }
      navigate(returnTo || '/profile')
      flushLoginCompleted()
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'This login link could not be used.'
    } finally {
      redeeming.value = false
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" />
        <h1>{error.value ? 'Login link failed' : token ? 'Almost signed in' : 'Login link failed'}</h1>
        {!token && <p class="account-message account-message--error">This login link is missing its token.</p>}
        {token && !error.value && (
          <>
            <p class="lede">One tap to finish signing in to Elixir Drop.</p>
            <button class="btn btn--gold" disabled={redeeming.value} onClick={() => void redeem()}>
              {redeeming.value ? 'Signing you in…' : 'Continue to Drop'}
            </button>
          </>
        )}
        {(error.value || !token) && (
          <>
            {error.value && <p class="account-message account-message--error">{error.value}</p>}
            <button class="btn btn--gold" onClick={() => navigate('/login')}>
              Request another link
            </button>
          </>
        )}
      </div>
    </div>
  )
}
