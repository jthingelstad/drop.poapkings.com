import { useSignal } from '@preact/signals'
import { track } from '../lib/analytics'
import Icon from './Icon'
import type { GameMode } from '@elixir-drop/contracts'

interface Props {
  text: string
  mode: GameMode
}

// Copyable, backend-free share line for the Surge summary.
export default function ShareLine({ text, mode }: Props) {
  const copied = useSignal(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard blocked — the input is still selectable as a fallback
    }
    copied.value = true
    track('game.shared', mode)
    window.setTimeout(() => (copied.value = false), 1800)
  }

  return (
    <div class="shareline">
      <div class="summary__label">Share your time</div>
      <div class="shareline__row">
        <input
          class="shareline__text"
          value={text}
          readonly
          aria-label="Share text"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button class="btn btn--purple btn--sm shareline__btn" onClick={copy}>
          {copied.value ? (
            <>
              Copied <Icon name="check" />
            </>
          ) : (
            'Copy'
          )}
        </button>
      </div>
    </div>
  )
}
