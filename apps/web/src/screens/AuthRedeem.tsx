import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { clearPendingElixirLogin, redeemAccount } from '../lib/account'
import {
  authReturnPathFromRoute,
  gamePathForRoute,
  loginRouteForReturnPath,
  profileRouteForGame
} from '../lib/game-routes'
import { navigate, route, routeQuery } from '../lib/router'
import Icon from '../components/Icon'

export default function AuthRedeem() {
  const error = useSignal('')
  const redeeming = useSignal(false)

  const query = new URLSearchParams(routeQuery(route.value))
  const token = query.get('token')
  // A link minted by the Elixir callback was never mailed, so no scanner can
  // have followed it: it redeems on arrival instead of waiting for a tap.
  const viaElixir = query.get('via') === 'elixir'
  const returnTo = authReturnPathFromRoute(route.value)
  const returnToGame = returnTo ? gamePathForRoute(returnTo) : undefined

  // Redemption waits for a real click: mail-security scanners follow and
  // execute login links, and an auto-redeeming page let them burn the
  // single-use token before the player ever saw the tab.
  async function redeem() {
    if (!token || redeeming.value) return
    redeeming.value = true
    error.value = ''
    try {
      const authenticatedPlayer = await redeemAccount(token)
      if (viaElixir) clearPendingElixirLogin()
      if (!authenticatedPlayer.favoriteCardId || !authenticatedPlayer.publicName) {
        navigate(returnToGame ? profileRouteForGame(returnToGame) : '/profile')
        return
      }
      navigate(returnTo || '/profile')
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'This login link could not be used.'
    } finally {
      redeeming.value = false
    }
  }

  useEffect(() => {
    if (viaElixir && token) void redeem()
  }, [viaElixir, token]) // eslint-disable-line react-hooks/exhaustive-deps -- redeem reads the latest signals; arrival is the trigger

  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <Icon name="loader-circle" className="route-loading__spinner" />
        <h1>
          {error.value
            ? 'Login link failed'
            : token
              ? viaElixir
                ? 'Signing you in with Elixir'
                : 'Almost signed in'
              : 'Login link failed'}
        </h1>
        {!token && <p class="account-message account-message--error">This login link is missing its token.</p>}
        {token && !error.value && (
          <>
            <p class="lede">
              {viaElixir ? 'Elixir vouched for you. One moment.' : 'One tap to finish signing in to Elixir Drop.'}
            </p>
            <button class="btn btn--gold" disabled={redeeming.value} onClick={() => void redeem()}>
              {redeeming.value ? 'Signing you in…' : 'Continue to Drop'}
            </button>
          </>
        )}
        {(error.value || !token) && (
          <>
            {error.value && <p class="account-message account-message--error">{error.value}</p>}
            <button
              class="btn btn--gold"
              onClick={() => navigate(returnTo ? loginRouteForReturnPath(returnTo) : '/login')}
            >
              Request another link
            </button>
          </>
        )}
      </div>
    </div>
  )
}
