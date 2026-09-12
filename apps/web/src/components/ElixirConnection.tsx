import { useSignal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import { beginElixirLogin, chooseElixirPlayer, disconnectElixirAccount } from '../lib/account'
import { ELIXIR_RETURN_PATH } from '@elixir-drop/contracts'
import Icon from './Icon'

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The Elixir block on Account: not connected → connect; connected → which of
// your Elixir players Drop shows, whether Elixir has verified it, and the
// picker when there is more than one to choose from. Verification is
// Elixir's fact, re-read only when you sign in with Elixir again.
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
        <div class="ed-account__line">Not connected</div>
        <div class="ed-account__line ed-account__muted">
          Connect your{' '}
          <a class="text-link" href="https://elixir.poapkings.com/" rel="noreferrer">
            Elixir
          </a>{' '}
          account to choose which of your players Drop shows. A player Elixir has verified gets the checkmark here too.
        </div>
        <div class="ed-account__actions">
          <button
            class="ed-btn ed-btn--ghost ed-btn--sm"
            disabled={busy.value}
            onClick={() => void run(() => beginElixirLogin(ELIXIR_RETURN_PATH))}
          >
            {busy.value ? 'Opening Elixir…' : 'Connect Elixir'}
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
  const needsChoice = !link.playerTag && link.candidates.length > 0
  const canSwitch = link.candidates.length > 1

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
        <div class="ed-account__line">Connected, no player chosen yet</div>
      )}
      <div class="ed-account__line ed-account__muted">
        Connected {when(link.linkedAt)} · checked {when(link.checkedAt)}
        {link.verified && link.verifiedAt ? ` · verified ${when(link.verifiedAt)}` : ''}
      </div>
      {!link.verified && link.playerTag && (
        <div class="ed-account__line ed-account__muted">
          Prove this player under{' '}
          <a class="text-link" href="https://elixir.poapkings.com/account/verify" rel="noreferrer">
            Elixir → Verify
          </a>{' '}
          (one battle with a deck Elixir names), then sign in with Elixir again to pick up the checkmark.
        </div>
      )}
      {link.trackRefused && (
        <div class="ed-account__line ed-account__muted">
          Elixir would not add <span class="ed-profile__reference">{link.trackRefused}</span> to your account (its
          player slots may be full), so it cannot be chosen here.
        </div>
      )}
      {(needsChoice || canSwitch) && (
        <div class="ed-elixir__picker" role="group" aria-label="Which of your Elixir players Drop shows">
          <div class="ed-account__label">{needsChoice ? 'Choose the player Drop shows' : 'Your Elixir players'}</div>
          {link.candidates.map((candidate) => {
            const current = candidate.playerTag === link.playerTag
            return (
              <button
                key={candidate.playerTag}
                type="button"
                class={`ed-elixir__candidate${current ? ' ed-elixir__candidate--current' : ''}`}
                aria-pressed={current}
                disabled={busy.value || current}
                onClick={() => void run(() => chooseElixirPlayer(candidate.playerTag))}
              >
                <span class="ed-elixir__candidate-name">{candidate.name ?? candidate.playerTag}</span>
                <span class="ed-profile__reference">{candidate.playerTag}</span>
                <span class="ed-elixir__candidate-meta">
                  {candidate.relationship === 'primary' ? 'you' : 'alt'}
                  {candidate.verified ? (
                    <>
                      {' '}
                      · <Icon name="circle-check" /> verified
                    </>
                  ) : (
                    ' · not verified'
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div class="ed-account__actions">
        <button
          class="ed-btn ed-btn--ghost ed-btn--sm"
          disabled={busy.value}
          onClick={() => void run(() => beginElixirLogin(ELIXIR_RETURN_PATH))}
        >
          Re-check with Elixir
        </button>
        <button class="ed-danger__open" disabled={busy.value} onClick={() => void run(disconnectElixirAccount)}>
          Disconnect
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
