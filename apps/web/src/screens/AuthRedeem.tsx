import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { redeemAccount } from '../lib/account'
import { gameReturnPathFromRoute, profileRouteForGame } from '../lib/game-routes'
import { navigate, route } from '../lib/router'

export default function AuthRedeem() {
  const error = useSignal('')

  useEffect(() => {
    const query = route.value.split('?')[1] || ''
    const token = new URLSearchParams(query).get('token')
    const returnTo = gameReturnPathFromRoute(route.value)
    if (!token) {
      error.value = 'This login link is missing its token.'
      return
    }
    void redeemAccount(token)
      .then((authenticatedPlayer) => {
        if (!authenticatedPlayer.favoriteCardId || !authenticatedPlayer.publicName) {
          navigate(returnTo ? profileRouteForGame(returnTo) : '/profile')
          return
        }
        navigate(returnTo || '/profile')
      })
      .catch((reason: unknown) => {
        error.value = reason instanceof Error ? reason.message : 'This login link could not be used.'
      })
  }, [error])

  return (
    <div class="main-content account-screen">
      <div class="account-card" aria-live="polite">
        <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" />
        <h1>{error.value ? 'Login link failed' : 'Signing you in…'}</h1>
        {error.value && (
          <>
            <p class="account-message account-message--error">{error.value}</p>
            <button class="btn btn--gold" onClick={() => navigate('/login')}>
              Request another link
            </button>
          </>
        )}
      </div>
    </div>
  )
}
