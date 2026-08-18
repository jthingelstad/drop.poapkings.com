import type { ComponentChildren } from 'preact'
import type { Card } from '../../types'
import { CardArt } from '../CardChrome'
import Icon from '../Icon'
import { observeInput, type InputObservation } from '../../lib/input-evidence'

// The one exchange board Trade and Ledger share. RED lane on top, BLUE below —
// Clash Royale's own geometry, internalised over thousands of matches. Between
// the lanes a single ledger line holds the balance: `?` until solved, then the
// value in gold. In Ledger that `?` is itself the Reveal control (the assist),
// so the control and the number it produces occupy one slot.

export interface LaneCard {
  card: Card
  showCost: boolean
  key: string | number
}

// One line of prose in both modes while asking; the same shape when solved.
export const EXCHANGE_PROMPT = 'Who came out ahead, and by how much?'

// Positive balance is a Blue advantage; negative a Red one. The one label both
// the ledger line and the solved sentence read from.
export function balanceWinner(balance: number): string {
  return balance > 0 ? `Blue +${balance}` : balance < 0 ? `Red +${Math.abs(balance)}` : 'Even'
}

// "Red spent 7 · Blue spent 6 · Blue +1".
export function exchangeSolvedLine(redSpent: number, blueSpent: number, balance: number): string {
  return `Red spent ${redSpent} · Blue spent ${blueSpent} · ${balanceWinner(balance)}`
}

function Lane({ side, cards }: { side: 'red' | 'blue'; cards: LaneCard[] }) {
  return (
    <section class={`ed-xlane ed-xlane--${side}`} aria-label={`${side === 'red' ? 'Red' : 'Blue'} plays`}>
      <span class="ed-xlane__label">{side === 'red' ? 'RED' : 'BLUE'}</span>
      <ol class="ed-xlane__cards">
        {cards.map((c) => (
          <li key={c.key} class={`ed-xcard${c.showCost ? ' ed-xcard--revealed' : ''}`} data-card-id={c.card.id}>
            <CardArt
              card={c.card}
              className="ed-xcard__art"
              imgClassName="ed-xcard__img"
              fallbackClassName="ed-xcard__fallback"
              showCost={c.showCost}
              costClassName="ed-xcard__cost"
              showName
              nameClassName="ed-xcard__name"
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ExchangeBoard({
  red,
  blue,
  balanceLabel,
  revealed,
  onReveal,
  trail,
  stage
}: {
  red: LaneCard[]
  blue: LaneCard[]
  /** The balance value once revealed, e.g. "Blue +1". */
  balanceLabel: string
  revealed: boolean
  /** Ledger's assist: when set and not yet revealed, the `?` becomes Reveal. */
  onReveal?: () => void
  trail?: ComponentChildren
  stage?: string
}) {
  return (
    <div class="ed-xboard" data-stage={stage}>
      <Lane side="red" cards={red} />
      <div class={`ed-xboard__balance${revealed ? ' ed-xboard__balance--revealed' : ''}`} aria-live="polite">
        {revealed ? (
          <strong class="ed-xboard__value">{balanceLabel}</strong>
        ) : onReveal ? (
          <button type="button" class="ed-xboard__reveal" onClick={onReveal}>
            <Icon name="scan-eye" /> Reveal
          </button>
        ) : (
          <strong class="ed-xboard__q" aria-hidden="true">
            ?
          </strong>
        )}
      </div>
      <Lane side="blue" cards={blue} />
      {trail}
    </div>
  )
}

// Two magnitude rows plus EVEN: red on top, blue below, matching the board. A
// blue key submits +magnitude, a red key −magnitude, EVEN submits 0 — the colour
// and position carry direction, so no sign and no group label is needed. Nothing
// underneath changes: the scorers still receive the same signed value the old
// −4…+4 pad produced.
export function ExchangePad({
  answers,
  onPick,
  disabled,
  stateFor
}: {
  answers: readonly number[]
  onPick: (value: number, observation: InputObservation) => void
  disabled: boolean
  /** Extra class(es) for a key, given its signed value (highlight state). */
  stateFor: (value: number) => string
}) {
  const magnitudes = answers.filter((v) => v > 0).sort((a, b) => a - b)
  return (
    <div class="ed-xpad" role="group" aria-label={EXCHANGE_PROMPT}>
      <div class="ed-xpad__row ed-xpad__row--red">
        {magnitudes.map((mag) => (
          <button
            key={`r${mag}`}
            type="button"
            class={`ed-xpad__key ed-xpad__key--red ${stateFor(-mag)}`}
            onClick={(event) => onPick(-mag, observeInput(event))}
            disabled={disabled}
            aria-label={`Red ahead by ${mag}`}
          >
            {mag}
          </button>
        ))}
      </div>
      <button
        type="button"
        class={`ed-xpad__key ed-xpad__key--even ${stateFor(0)}`}
        onClick={(event) => onPick(0, observeInput(event))}
        disabled={disabled}
        aria-label="Even"
      >
        EVEN
      </button>
      <div class="ed-xpad__row ed-xpad__row--blue">
        {magnitudes.map((mag) => (
          <button
            key={`b${mag}`}
            type="button"
            class={`ed-xpad__key ed-xpad__key--blue ${stateFor(mag)}`}
            onClick={(event) => onPick(mag, observeInput(event))}
            disabled={disabled}
            aria-label={`Blue ahead by ${mag}`}
          >
            {mag}
          </button>
        ))}
      </div>
    </div>
  )
}
