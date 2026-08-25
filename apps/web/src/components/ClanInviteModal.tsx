import { useEffect, useRef, useState } from 'preact/hooks'
import { clanChatInviteMessage, discordInviteMessage, type ClanInviteContext } from '../lib/clan-invite'
import { prepareProfileShare } from '../lib/share-profile'
import DetailModal from './DetailModal'
import Icon from './Icon'
import ScopeRow from './ScopeRow'

type InviteSurface = 'clan' | 'discord'
type CopyOutcome = 'idle' | 'copied' | 'manual' | 'profile-error'

interface Props extends ClanInviteContext {
  onClose: () => void
  returnFocus: HTMLElement | null
  prepareProfileLink?: () => Promise<string>
}

export default function ClanInviteModal({
  gameName,
  playerName,
  clanName,
  result,
  onClose,
  returnFocus,
  prepareProfileLink = prepareProfileShare
}: Props) {
  const [surface, setSurface] = useState<InviteSurface>('clan')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<CopyOutcome>('idle')
  const [manualMessage, setManualMessage] = useState('')
  const resetTimer = useRef<number | undefined>(undefined)
  const context = { gameName, playerName, clanName, result }
  const clanMessage = clanChatInviteMessage(context)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  function selectSurface(next: InviteSurface) {
    if (busy || next === surface) return
    window.clearTimeout(resetTimer.current)
    setSurface(next)
    setOutcome('idle')
    setManualMessage('')
  }

  async function copyMessage() {
    if (busy) return
    setBusy(true)
    setOutcome('idle')
    setManualMessage('')

    let message = clanMessage
    if (surface === 'discord') {
      try {
        const profileUrl = await prepareProfileLink()
        message = discordInviteMessage(context, profileUrl)
      } catch {
        setOutcome('profile-error')
        setBusy(false)
        return
      }
    }

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(message)
      setOutcome('copied')
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setOutcome('idle'), 1_800)
    } catch {
      setManualMessage(message)
      setOutcome('manual')
    } finally {
      setBusy(false)
    }
  }

  const destination = surface === 'clan' ? 'Clan Chat' : 'Discord'

  return (
    <DetailModal label="Invite clanmates" onClose={onClose} className="ed-clan-invite-modal" returnFocus={returnFocus}>
      <div class="ed-clan-invite-modal__head">
        <span class="ed-clan-invite-modal__mark" aria-hidden="true">
          <Icon name="user" />
        </span>
        <div>
          <h2>Invite clanmates</h2>
          <p>Choose where you’ll post it.</p>
        </div>
      </div>

      <ScopeRow
        ariaLabel="Choose an invite destination"
        active={surface}
        onSelect={selectSurface}
        options={[
          { key: 'clan', label: 'Clan Chat' },
          { key: 'discord', label: 'Discord' }
        ]}
      />

      <p class="ed-clan-invite-modal__hint">
        {surface === 'clan'
          ? 'Plain text that works inside Clash Royale.'
          : 'Markdown with your personal Recruiter link.'}
      </p>

      <div class="ed-clan-invite-modal__preview" aria-label={`${destination} message preview`}>
        {surface === 'clan' ? (
          <p>{clanMessage}</p>
        ) : (
          <>
            <p>
              I'm <strong>{playerName}</strong>
              {result ? (
                <>
                  , currently{' '}
                  <strong>
                    #{result.rank} in {gameName}
                  </strong>{' '}
                  on <strong>{clanName ? `${clanName} Clan Ladder` : 'our Clan Ladder'}</strong> (best:{' '}
                  <strong>{result.score}</strong>).
                </>
              ) : (
                <>
                  , playing <strong>{gameName}</strong> on{' '}
                  <strong>{clanName ? `${clanName} Clan Ladder` : 'our Clan Ladder'}</strong>.
                </>
              )}
            </p>
            <p>
              Think you can beat me?{' '}
              <span class="ed-clan-invite-modal__preview-link">Take the challenge on Elixir Drop</span>
            </p>
          </>
        )}
      </div>

      <button
        class="ed-btn ed-btn--ghost ed-clan-invite-modal__copy"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void copyMessage()}
      >
        <Icon
          name={outcome === 'copied' ? 'check' : busy ? 'loader-circle' : 'copy'}
          className={busy ? 'icon--spin' : undefined}
        />
        {busy
          ? surface === 'discord'
            ? 'Preparing your link…'
            : 'Copying…'
          : outcome === 'copied'
            ? `Copied for ${destination}`
            : `Copy for ${destination}`}
      </button>

      <div class="ed-clan-invite-modal__status" aria-live="polite">
        {outcome === 'copied' && `Copied for ${destination}.`}
        {outcome === 'profile-error' && 'Your personal Drop link could not be prepared. Try again.'}
        {outcome === 'manual' && (
          <label class="ed-clan-invite-modal__fallback">
            <span>Copy this message:</span>
            <textarea
              aria-label={`${destination} invite message`}
              readOnly
              rows={5}
              value={manualMessage}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
        )}
      </div>
    </DetailModal>
  )
}
