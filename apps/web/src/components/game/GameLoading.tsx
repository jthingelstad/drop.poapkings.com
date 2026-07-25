// The pre-countdown hold every mode shows between "the route mounted" and "the
// signed challenge + card art are ready". Deliberately not the GameFrame: there
// is no run to put chrome around yet.
export default function GameLoading({ label = 'Loading cards…' }: { label?: string }) {
  return (
    <div class="ed-gamewrap ed-gameloading" aria-live="polite">
      <span class="ed-drop-shape ed-gameloading__drop" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
