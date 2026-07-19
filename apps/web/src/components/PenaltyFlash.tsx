import Icon from './Icon'

// Flashes the penalty the moment it lands — the clock jumping silently hid
// the cost model from new players. The slot always reserves space so HUDs
// never shift mid-run.
export default function PenaltyFlash({ pulse, label }: { pulse: number; label: string }) {
  return (
    <span class="penalty-flash" aria-live="polite">
      {pulse > 0 && (
        <span key={pulse} class="penalty-flash__chip">
          <Icon name="timer" /> {label}
        </span>
      )}
    </span>
  )
}
