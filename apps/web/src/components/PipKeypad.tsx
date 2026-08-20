import { animate } from 'motion'
import { useRef } from 'preact/hooks'
import { allCards } from '../lib/card-catalog'
import { isEnhancedEffectsEnabled } from '../lib/motion'
import { playTap } from '../lib/sound'
import { useGameKeys } from '../lib/use-game-keys'
import { observeInput, type InputObservation } from '../lib/input-evidence'
import { costForGameKey, keyLegendForCost } from '../lib/game-keys'

// The keypad only offers costs that exist in the catalog — a dead "10" key was
// pure penalty bait and stole tap-target width on phones.
const MAX_ELIXIR = Math.max(...allCards.map((card) => card.elixir))

// 1..N ascending. Fixed positions across every device mean muscle memory holds
// in a speed game — which is why the ORDER never varies, only how many rows it
// is dealt across.
const KEY_ORDER = Array.from({ length: MAX_ELIXIR }, (_, i) => i + 1)

// The keypad is dealt as two rows — 1-5 over 6-9 — each filling the full width,
// so a key is about twice as wide as a single row of nine. Mistaps happen
// sideways, between neighbours, so width is the axis that matters; this is the
// only keypad now. Splitting after 5 rather than halving means a future 10-cost
// card lands on the bottom row instead of shifting 1-5 out from under a thumb
// that has learned where they are.
const SPEEDRUN_TOP_ROW = 5

interface Props {
  onPick: (value: number, observation: InputObservation) => void
  disabled?: boolean
}

// Enhanced-effects flourish on tap: a springy overshoot on the key face, a
// radiating gold ring, and a small elixir-droplet spray — all appended to the
// key and self-removing so nothing accumulates. The tactile "pressed keycap"
// depress itself is CSS on :active and always on (see .pip-keypad__pip). Reduced
// motion disables enhanced effects, so this never runs then.
function pressFx(button: HTMLButtonElement): void {
  const face = button.querySelector<HTMLElement>('.pip-keypad__face')
  if (face) {
    animate(
      face,
      { transform: ['scale(0.82)', 'scale(1.09)', 'scale(1)'] },
      { duration: 0.34, ease: [0.34, 1.5, 0.5, 1] }
    )
  }
  const ring = document.createElement('span')
  ring.className = 'pip-keypad__ring'
  button.appendChild(ring)
  void animate(
    ring,
    { transform: ['translate(-50%,-50%) scale(0.5)', 'translate(-50%,-50%) scale(1.95)'], opacity: [0.8, 0] },
    { duration: 0.44, ease: 'easeOut' }
  ).finished.then(() => ring.remove())
  for (let i = 0; i < 6; i += 1) {
    const drop = document.createElement('span')
    drop.className = 'pip-keypad__spark'
    button.appendChild(drop)
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2
    const dist = 22 + Math.random() * 26
    void animate(
      drop,
      {
        transform: [
          'translate(-50%,-50%) scale(1)',
          `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.4)`
        ],
        opacity: [1, 0]
      },
      { duration: 0.5 + Math.random() * 0.24, ease: 'easeOut' }
    ).finished.then(() => drop.remove())
  }
}

function PipKey({
  value,
  disabled,
  onPick
}: {
  value: number
  disabled?: boolean
  onPick: (value: number, observation: InputObservation) => void
}) {
  function activate(button: HTMLButtonElement, event: Event): void {
    playTap()
    if (isEnhancedEffectsEnabled()) pressFx(button)
    onPick(value, observeInput(event))
  }

  return (
    <button
      data-pip-value={value}
      class={`pip-keypad__pip${disabled ? ' pip-keypad__pip--disabled' : ''}`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || event.isPrimary === false) return
        // Accept the answer in the same event that produces the key feedback.
        // iOS Safari can cancel the later compatibility click after a valid
        // touch, which previously left a sparkling key but an unchanged card.
        activate(event.currentTarget, event)
      }}
      onClick={(event) => {
        // Pointer activation was already handled atomically above. A click with
        // detail=0 is keyboard or assistive activation and still needs the
        // native button path; pointer-generated clicks have a positive detail.
        if (disabled || event.detail > 0) return
        activate(event.currentTarget, event)
      }}
      aria-label={`${value} elixir`}
      aria-keyshortcuts={`${value} ${keyLegendForCost(value)}`}
      disabled={disabled}
    >
      <span class="pip-keypad__face">
        <span class="pip-keypad__num">{value}</span>
        <kbd class="pip-keypad__shortcut" aria-hidden="true">
          {keyLegendForCost(value)}
        </kbd>
      </span>
    </button>
  )
}

export default function PipKeypad({ onPick, disabled }: Props) {
  const groupRef = useRef<HTMLDivElement>(null)

  // Desktop keyboard: the advertised home row and number-row alias answer with
  // the same tap sound + key FX as a click.
  useGameKeys((event) => {
    if (disabled) return
    const value = costForGameKey(event)
    if (value === null || value > MAX_ELIXIR) return
    event.preventDefault()
    const button = groupRef.current?.querySelector<HTMLButtonElement>(`[data-pip-value="${value}"]`)
    playTap()
    if (button && isEnhancedEffectsEnabled()) pressFx(button)
    onPick(value, observeInput(event))
  })

  const rows = [KEY_ORDER.slice(0, SPEEDRUN_TOP_ROW), KEY_ORDER.slice(SPEEDRUN_TOP_ROW)]

  return (
    <div ref={groupRef} class="pip-keypad" role="group" aria-label="Elixir cost keypad">
      {rows.map((row, index) => (
        <div class="pip-keypad__row" key={`row-${index}`}>
          {row.map((n) => (
            <PipKey key={n} value={n} disabled={disabled} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  )
}
