import { useSignal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import { beginElixirLogin } from '../lib/account'
import { ELIXIR_RETURN_PATH } from '@elixir-drop/contracts'
import Icon from './Icon'

/** Where a person changes the name and picture Drop shows: their Elixir
 *  account. Drop has no screen of its own for either (2026-11-14). */
export const ELIXIR_URL = 'https://elixir.poapkings.com/'

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// What a signed-in player with no player on their Elixir account sees: Drop
// reads players from Elixir and adds none itself (Jamie, 2026-11-12).
export function NoElixirPlayer() {
  return (
    <p class="ed-account__line ed-account__muted">
      Your Elixir account has no Clash Royale player yet. Add one at{' '}
      <a class="text-link" href="https://elixir.poapkings.com" rel="noreferrer">
        elixir.poapkings.com
      </a>
      , then sign in with Elixir again.
    </p>
  )
}

// The Elixir block on Account. A Drop account is an Elixir account, so there
// is no disconnect: before the first sign-in that reads the person's players
// (an account from the email-sign-in days), it offers that check; after it,
// the primary player Drop shows and whether Elixir has verified it. There is
// nothing to choose (2026-11-14): Drop shows the account's primary player,
// never an alt, and the name and picture set in Elixir. Both are re-read
// when you sign in with Elixir again.
export default function ElixirConnection({ player }: { player: Player }) {
  const busy = useSignal(false)
  const error = useSignal('')
  const link = player.elixir

  async function run(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'That did not work. Try again.'
    } finally {
      busy.value = false
    }
  }

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
          <button
            class="ed-btn ed-btn--ghost ed-btn--sm"
            disabled={busy.value}
            onClick={() => void run(() => beginElixirLogin(ELIXIR_RETURN_PATH))}
          >
            {busy.value ? 'Opening Elixir…' : 'Check with Elixir'}
          </button>
        </div>
        {error.value && (
          <div class="ed-edit__msg ed-edit__msg--err" role="alert">
            {error.value}
          </div>
        )}
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
        <div class="ed-account__line">Connected, no primary player yet</div>
      )}
      <div class="ed-account__line ed-account__muted">
        Connected {when(link.linkedAt)} · checked {when(link.checkedAt)}
        {link.verified && link.verifiedAt ? ` · verified ${when(link.verifiedAt)}` : ''}
      </div>
      {!link.verified && link.playerTag && (
        <div class="ed-account__line ed-account__muted">
          Prove this player under{' '}
          <a class="text-link" href="https://elixir.poapkings.com/console/account/verify" rel="noreferrer">
            Elixir → Verify
          </a>{' '}
          (one battle with a deck Elixir names), then sign in with Elixir again to pick up the checkmark.
        </div>
      )}
      {!link.playerTag && player.playerTag && (
        <div class="ed-account__line ed-account__muted">
          Drop keeps the tag you typed in before, <span class="ed-profile__reference">{player.playerTag}</span>, as not
          verified.
        </div>
      )}
      {link.candidates.length === 0 && <NoElixirPlayer />}
      <div class="ed-account__line ed-account__muted">
        Your name and picture come from your{' '}
        <a class="text-link" href={ELIXIR_URL} rel="noreferrer">
          Elixir
        </a>{' '}
        account: the primary player's Clash Royale name and the profile picture you set there. Change them on Elixir,
        then re-check.
      </div>
      <div class="ed-account__actions">
        <button
          class="ed-btn ed-btn--ghost ed-btn--sm"
          disabled={busy.value}
          onClick={() => void run(() => beginElixirLogin(ELIXIR_RETURN_PATH))}
        >
          Re-check with Elixir
        </button>
      </div>
      {error.value && (
        <div class="ed-edit__msg ed-edit__msg--err" role="alert">
          {error.value}
        </div>
      )}
    </div>
  )
}
