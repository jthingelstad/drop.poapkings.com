import rawCards from '@elixir-drop/game-data/cards.json'
import type { CardsData } from '../types'

// The keypad only offers costs that exist in the catalog — a dead "10" key
// was pure penalty bait and stole tap-target width on phones.
const MAX_ELIXIR = Math.max(...(rawCards as CardsData).cards.map((card) => card.elixir))

interface Props {
  onPick: (value: number) => void
  disabled?: boolean
}

export default function PipKeypad({ onPick, disabled }: Props) {
  return (
    <div class="pip-keypad" role="group" aria-label="Elixir cost keypad">
      {Array.from({ length: MAX_ELIXIR }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          class={`pip-keypad__pip${disabled ? ' pip-keypad__pip--disabled' : ''}`}
          onClick={() => !disabled && onPick(n)}
          aria-label={`${n} elixir`}
          disabled={disabled}
        >
          <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
          <span>{n}</span>
        </button>
      ))}
    </div>
  )
}
