import type { Card } from '../../types'
import { CardArt } from '../CardChrome'
import { observeInput, type InputObservation } from '../../lib/input-evidence'
import { keyLegendForCost } from '../../lib/game-keys'

// Trade's exchange board. RED lane on top, BLUE below — Clash Royale's own
// geometry, internalised over thousands of matches. Between the lanes a single
// balance line holds `?` until the exchange is solved, then the value in gold.

export interface LaneCard {
  card: Card
  showCost: boolean
  key: string | number
}

// One line of prose while asking; the same shape when solved.
export const EXCHANGE_PROMPT = 'Who came out ahead, and by how much?'

// Positive balance is a Blue advantage; negative a Red one. The balance line
// and the solved sentence read from the same label.
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
  revealed
}: {
  red: LaneCard[]
  blue: LaneCard[]
  /** The balance value once revealed, e.g. "Blue +1". */
  balanceLabel: string
  revealed: boolean
}) {
  return (
    <div class="ed-xboard">
      <Lane side="red" cards={red} />
      <div class={`ed-xboard__balance${revealed ? ' ed-xboard__balance--revealed' : ''}`} aria-live="polite">
        {revealed ? (
          <strong class="ed-xboard__value">{balanceLabel}</strong>
        ) : (
          <strong class="ed-xboard__q" aria-hidden="true">
            ?
          </strong>
        )}
      </div>
      <Lane side="blue" cards={blue} />
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
            <span>{mag}</span>
            <kbd class="ed-xpad__shortcut" aria-hidden="true">
              {keyLegendForCost(mag + 5)}
            </kbd>
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
        <span>EVEN</span>
        <kbd class="ed-xpad__shortcut" aria-hidden="true">
          {keyLegendForCost(5)}
        </kbd>
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
            <span>{mag}</span>
            <kbd class="ed-xpad__shortcut" aria-hidden="true">
              {keyLegendForCost(mag)}
            </kbd>
          </button>
        ))}
      </div>
    </div>
  )
}
