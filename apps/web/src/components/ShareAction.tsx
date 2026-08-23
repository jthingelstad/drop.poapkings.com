import { useEffect, useRef, useState } from 'preact/hooks'
import { shareLink, type RunShareOutcome } from '../lib/share-run'
import Icon from './Icon'

interface Props {
  prepare: () => Promise<string>
  onComplete?: (outcome: 'shared' | 'copied') => void
  className?: string
  buttonClassName?: string
  statusClassName?: string
}

export default function ShareAction({
  prepare,
  onComplete,
  className = 'ed-link-action',
  buttonClassName = 'ed-btn ed-btn--ghost',
  statusClassName = 'ed-link-action__status'
}: Props) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RunShareOutcome | null>(null)
  const [url, setUrl] = useState('')
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function share() {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    setUrl('')
    try {
      const preparedUrl = await prepare()
      setUrl(preparedUrl)
      const result = await shareLink(preparedUrl)
      if (result === 'cancelled') return
      setOutcome(result)
      if (result === 'shared' || result === 'copied') {
        onComplete?.(result)
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => {
          setOutcome(null)
          setUrl('')
        }, 1800)
      }
    } catch {
      setOutcome('unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class={className}>
      <button
        class={`${buttonClassName} ed-link-action__button`}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void share()}
      >
        <Icon name="share" /> SHARE
      </button>
      <span class={statusClassName} aria-live="polite">
        {outcome === 'copied' && 'Link copied.'}
        {outcome === 'shared' && 'Shared.'}
        {outcome === 'unavailable' && !url && 'Sharing is unavailable right now.'}
        {outcome === 'unavailable' && url && (
          <label class="ed-link-action__fallback">
            <span>Copy this link:</span>
            <input
              aria-label="Share link"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
        )}
      </span>
    </div>
  )
}
