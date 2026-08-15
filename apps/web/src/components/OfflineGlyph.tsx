import Icon from './Icon'

// Offline is a persistent state, so it gets a persistent mark rather than a
// banner. A banner that never leaves stops being information and becomes
// furniture — and it sat above the game while you were playing.
//
// It rides in the player chip, which is already the app's status corner, and
// carries its own accessible name because the glyph itself is decorative.
export default function OfflineGlyph() {
  return (
    <span class="ed-offline-glyph" title="Offline" aria-label="Offline" role="img">
      <Icon name="wifi-off" />
    </span>
  )
}
