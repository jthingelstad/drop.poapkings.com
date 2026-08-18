import type { JSX } from 'preact'

// The charge ring: the loading shape for a wait where no screen exists yet — a
// route chunk, a game preparing, a reconnect. Nothing is on screen, so the ring
// IS the screen. It fills the same 172px slot in the same gold as the 3·2·1
// countdown numeral, so loading a game and starting one are one continuous
// motion — the arc completes, the numeral takes its place, nothing jumps.
//
// The arc always fills (it is progress, not decoration), so the fill runs even
// under reduced motion. The reconnecting variant instead holds at a quarter turn
// with a slow pulse — and only that pulse is suppressed under reduced motion.

// 2π·44, the arc's circumference at the viewBox radius below.
const CIRCUMFERENCE = 276.46

export default function ChargeRing({
  variant = 'fill',
  label = 'Charging',
  note
}: {
  variant?: 'fill' | 'reconnecting'
  label?: string
  note?: string
}) {
  const reconnecting = variant === 'reconnecting'
  const arcStyle = {
    strokeDasharray: CIRCUMFERENCE,
    // Reconnecting holds a quarter turn shown; fill lets the animation drive it.
    ...(reconnecting ? { strokeDashoffset: CIRCUMFERENCE * 0.75 } : {})
  } as JSX.CSSProperties
  return (
    <div
      class={`charge-ring${reconnecting ? ' charge-ring--reconnecting' : ''}`}
      role="status"
      aria-label={reconnecting ? 'Reconnecting' : label}
    >
      <svg class="charge-ring__svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="charge-ring__track" cx="50" cy="50" r="44" />
        <circle class="charge-ring__arc" cx="50" cy="50" r="44" style={arcStyle} />
      </svg>
      <span class="charge-ring__label">{reconnecting ? 'Reconnecting' : label}</span>
      {reconnecting && (
        <p class="charge-ring__note">
          {note ?? 'Games still work from this device — boards and badges fill in when Drop is back.'}
        </p>
      )}
    </div>
  )
}
