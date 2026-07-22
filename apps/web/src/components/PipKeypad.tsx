import { animate } from 'motion'
import { useRef } from 'preact/hooks'
import rawCards from '@elixir-drop/game-data/cards.json'
import type { CardsData } from '../types'
import { isEnhancedEffectsEnabled } from '../lib/motion'
import { playTap } from '../lib/sound'

// The keypad only offers costs that exist in the catalog — a dead "10" key was
// pure penalty bait and stole tap-target width on phones.
const MAX_ELIXIR = Math.max(...(rawCards as CardsData).cards.map((card) => card.elixir))

// Locked single row, 1..N ascending — the one keypad layout in the redesign
// (design-ref/SPEC-EXTRACT.md). Fixed positions across every device mean muscle
// memory holds in a speed game.
const KEY_ORDER = Array.from({ length: MAX_ELIXIR }, (_, i) => i + 1)

interface Props {
  onPick: (value: number) => void
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

function PipKey({ value, disabled, onPick }: { value: number; disabled?: boolean; onPick: (value: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      class={`pip-keypad__pip${disabled ? ' pip-keypad__pip--disabled' : ''}`}
      onPointerDown={() => {
        if (disabled) return
        playTap()
        if (isEnhancedEffectsEnabled() && ref.current) pressFx(ref.current)
      }}
      onClick={() => !disabled && onPick(value)}
      aria-label={`${value} elixir`}
      disabled={disabled}
    >
      <span class="pip-keypad__face">
        <span class="pip-keypad__num">{value}</span>
      </span>
    </button>
  )
}

export default function PipKeypad({ onPick, disabled }: Props) {
  return (
    <div class="pip-keypad" role="group" aria-label="Elixir cost keypad">
      {KEY_ORDER.map((n) => (
        <PipKey key={n} value={n} disabled={disabled} onPick={onPick} />
      ))}
    </div>
  )
}
