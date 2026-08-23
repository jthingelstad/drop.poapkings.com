import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import ChargeRing from '../components/ChargeRing'
import GateCard from '../components/GateCard'
import Icon from '../components/Icon'
import { getSharedInvite } from '../lib/api'
import { sessionToken } from '../lib/account'
import { rememberRecruiter } from '../lib/referral'
import { navigate, replace } from '../lib/router'
import { shareTokenFromRoute } from '../lib/share-links'

export function sharedInviteToken(route: string): string | undefined {
  return shareTokenFromRoute(route, 's')
}

export default function SharedInvite({ token }: { token: string }) {
  const failed = useSignal(false)

  useEffect(() => {
    const controller = new AbortController()
    failed.value = false
    getSharedInvite(token, controller.signal, sessionToken())
      .then((result) => {
        rememberRecruiter(result.token)
        if (result.destination === 'player' && result.playerId) {
          replace(`/players/${encodeURIComponent(result.playerId)}`)
          return
        }
        replace('/')
      })
      .catch(() => {
        if (!controller.signal.aborted) failed.value = true
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div class="main-content">
      {failed.value ? (
        <GateCard
          mark={<Icon name="triangle-alert" />}
          state="Link not found"
          primary={{ label: 'Open Elixir Drop', onAction: () => navigate('/') }}
        >
          That shared link could not be found. It may be mistyped, or the player may have deleted their account.
        </GateCard>
      ) : (
        <GateCard mark={<ChargeRing />} state="Opening shared link" primary={{ label: 'Opening…', disabled: true }}>
          Getting the arena ready…
        </GateCard>
      )}
    </div>
  )
}
