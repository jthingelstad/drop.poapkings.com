import { useSignal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import { beginElixirLogin } from '../lib/account'
import { ELIXIR_RETURN_PATH } from '@elixir-drop/contracts'
import Icon from './Icon'

/** Where a person changes the name and picture Drop shows: the primary
 *  player and the picture on their Elixir profile. Drop has no screen of its
 *  own for either (2026-11-14). */
export const ELIXIR_PROFILE_URL = 'https://elixir.poapkings.com/settings/profile'
/** Where a person adds a Clash Royale player to Elixir, or verifies one. */
export const ELIXIR_PLAYERS_URL = 'https://elixir.poapkings.com/settings/players'

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// What a signed-in player with no primary player on their Elixir account
// sees: Drop reads the player from Elixir and adds none itself.
function NoElixirPlayer() {
  return (
    <p class="ed-account__line ed-account__muted">
      Your Elixir account has no Clash Royale player yet.{' '}
      <a class="text-link" href={ELIXIR_PLAYERS_URL} rel="noreferrer">
        Add one on Elixir
      </a>
      , then refresh from Elixir.
    </p>
  )
}

// The Elixir block on Account. A Drop account is an Elixir account, and
// everything here is Elixir's: the primary player, whether Elixir has
// verified it, the name and the picture. Drop offers no way to change any of
// it. Elixir is read only at a sign-in, so "Refresh from Elixir" starts that
// same Sign in with Elixir flow from this signed-in state; it returns here
// with what Elixir has now. Before the first sign-in that read the person's
// players (an account from the email-sign-in days) it offers that check.
export default function ElixirConnection({ player }: { player: Player }) {
  const busy = useSignal(false)
  const error = useSignal('')
  const link = player.elixir

  async function refresh() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await beginElixirLogin(ELIXIR_RETURN_PATH)
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'That did not work. Try again.'
      busy.value = false
    }
  }

  const failure = error.value && (
    <div class="ed-edit__msg ed-edit__msg--err" role="alert">
      {error.value}
    </div>
  )

  if (!link) {
    return (
      <div class="ed-account__block ed-elixir">
        <div class="ed-account__label">Elixir</div>
        <div class="ed-account__line">Not checked with Elixir yet</div>
        <div class="ed-account__line ed-account__muted">
          Your Drop account is your{' '}
          <a class="text-link" href="https://elixir.poapkings.com/" rel="noreferrer">
            Elixir
          </a>{' '}
          account. Check with Elixir to bring in your Clash Royale name and the profile picture you set there.
        </div>
        <div class="ed-account__actions">
          <button class="ed-btn ed-btn--ghost ed-btn--sm" disabled={busy.value} onClick={() => void refresh()}>
            {busy.value ? 'Opening Elixir…' : 'Check with Elixir'}
          </button>
        </div>
        {failure}
      </div>
    )
  }

  const chosen = link.candidates.find((c) => c.playerTag === link.playerTag)

  return (
    <div class="ed-account__block ed-elixir">
      <div class="ed-account__label">Elixir</div>
      {link.playerTag ? (
        <div class="ed-account__line">
          {link.playerName ?? chosen?.name ?? link.playerTag}{' '}
          <span class="ed-profile__reference">{link.playerTag}</span>
          {link.verified ? (
            <span class="ed-elixir__verified" title="Verified in Elixir">
              <Icon name="circle-check" /> verified
            </span>
          ) : (
            <span class="ed-elixir__unverified">not verified</span>
          )}
        </div>
      ) : (
        <div class="ed-account__line">No Clash Royale player</div>
      )}
      <div class="ed-account__line ed-account__muted">
        Connected {when(link.linkedAt)} · checked {when(link.checkedAt)}
        {link.verified && link.verifiedAt ? ` · verified ${when(link.verifiedAt)}` : ''}
      </div>
      {!link.verified && link.playerTag && (
        <div class="ed-account__line ed-account__muted">
          Not verified yet.{' '}
          <a class="text-link" href={ELIXIR_PLAYERS_URL} rel="noreferrer">
            Verify it on Elixir
          </a>
          , then refresh from Elixir to get the checkmark.
        </div>
      )}
      {!link.playerTag && <NoElixirPlayer />}
      <div class="ed-account__line ed-account__muted">
        Your name, picture and player come from your Elixir account.{' '}
        <a class="text-link" href={ELIXIR_PROFILE_URL} rel="noreferrer">
          Change them on Elixir
        </a>
        , then refresh.
      </div>
      <div class="ed-account__actions">
        <button class="ed-btn ed-btn--ghost ed-btn--sm" disabled={busy.value} onClick={() => void refresh()}>
          {busy.value ? 'Opening Elixir…' : 'Refresh from Elixir'}
        </button>
      </div>
      {failure}
    </div>
  )
}
