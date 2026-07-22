// Mobile Home install entry points. A prominent, dismissible banner at the top
// of Home; once dismissed, a permanent compact row near the bottom keeps it
// reachable. Both open the full Install page (Profile → Install app), except on
// Android/Chrome where the banner's Install button fires the real prompt.
// Rendered on the mobile shell only — desktop has no install (it exists to shed
// the mobile browser chrome for full-screen play).

import { installMode, installDismissed, promptInstall, dismissInstall } from '../lib/pwa-install'
import { navigate } from '../lib/router'
import { tapFxFrom } from '../lib/tap-fx'
import Icon from './Icon'

// The banner's primary action: install directly where the browser supports it,
// otherwise send the player to the step-by-step Install page.
function install(): void {
  if (installMode.value === 'available') void promptInstall()
  else navigate('/install')
}

// Prominent gold banner, shown until dismissed.
export function InstallBanner() {
  if (installMode.value === 'none' || installDismissed.value) return null
  return (
    <div class="ed-installbar" role="note">
      <span class="ed-installbar__icon">
        <Icon name="download" />
      </span>
      <div class="ed-installbar__text">
        <span class="ed-installbar__title">Install for full-screen play</span>
        <span class="ed-installbar__sub">Add Drop to your home screen</span>
      </div>
      <button
        class="ed-installbar__go tap-fx"
        onClick={(e) => {
          tapFxFrom(e)
          install()
        }}
      >
        <span class="tap-face">Install</span>
      </button>
      <button class="ed-installbar__x" aria-label="Dismiss" onClick={dismissInstall}>
        <Icon name="x" />
      </button>
    </div>
  )
}

// Compact, always-present row after the banner is dismissed.
export function InstallRow() {
  if (installMode.value === 'none' || !installDismissed.value) return null
  return (
    <button class="ed-installrow tap-fx" onClick={() => navigate('/install')}>
      <span class="ed-installrow__icon">
        <Icon name="download" />
      </span>
      <span class="ed-installrow__text">Install for full-screen play</span>
      <Icon name="chevron-right" className="ed-installrow__end" />
    </button>
  )
}
