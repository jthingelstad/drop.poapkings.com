// A dismissible "Add to Home Screen" card. Shows a real Install button where the
// browser supports it (Android/Chrome), a manual Share-sheet hint on iOS Safari,
// and nothing at all once installed/standalone or dismissed. Rendered on Home.

import { installMode, promptInstall, dismissInstall } from '../lib/pwa-install'
import { tapFxFrom } from '../lib/tap-fx'
import Icon from './Icon'

export default function InstallPrompt() {
  const mode = installMode.value
  if (mode === 'none') return null
  return (
    <div class="ed-install" role="note">
      <span class="ed-install__icon">
        <Icon name={mode === 'ios' ? 'share' : 'download'} />
      </span>
      <div class="ed-install__text">
        <span class="ed-install__title">Play fullscreen</span>
        <span class="ed-install__sub">
          {mode === 'available' ? (
            'Install Elixir Drop for an app-like, fullscreen game.'
          ) : (
            <>
              Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> — no Safari bar.
            </>
          )}
        </span>
      </div>
      {mode === 'available' && (
        <button
          class="ed-install__go tap-fx"
          onClick={(e) => {
            tapFxFrom(e)
            void promptInstall()
          }}
        >
          <span class="tap-face">Install</span>
        </button>
      )}
      <button class="ed-install__x" aria-label="Dismiss" onClick={dismissInstall}>
        <Icon name="x" />
      </button>
    </div>
  )
}
