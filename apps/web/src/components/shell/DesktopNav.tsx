import { navigate, route } from '../../lib/router'
import { hasUnreadUpdates } from '../../lib/updates'
import { openKeyboardHelp } from '../../lib/keyboard-help'
import Icon from '../Icon'
import Wordmark from '../brand/Wordmark'
import { NAV_ITEMS, activeNavIndex } from './nav'

export default function DesktopNav() {
  const active = activeNavIndex(route.value)

  return (
    <aside class="ed-desktop__rail" aria-label="Desktop navigation">
      <Wordmark className="ed-desktop__brand" />
      <nav class="ed-nav" aria-label="Primary">
        {NAV_ITEMS.map((item, index) => (
          <button
            key={item.route}
            class="ed-nav__item"
            aria-current={index === active ? 'page' : undefined}
            onClick={() => navigate(item.route)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.route === '/profile' && hasUnreadUpdates.value && (
              <span class="ed-nav-dot" aria-label="Unread updates" />
            )}
          </button>
        ))}
      </nav>

      <div class="ed-desktop-keys" aria-label="Desktop keyboard shortcuts">
        <div class="ed-desktop-keys__head">
          <span>Speed keys</span>
          <button type="button" onClick={openKeyboardHelp} aria-label="Open keyboard controls">
            ?
          </button>
        </div>
        <div class="ed-desktop-keys__row" aria-hidden="true">
          {['A', 'S', 'D', 'F', 'G', 'J', 'K', 'L', ';'].map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </div>
        <div class="ed-desktop-keys__row ed-desktop-keys__row--cost" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cost) => (
            <span key={cost}>{cost}</span>
          ))}
        </div>
        <div class="ed-desktop-keys__space">
          <kbd>SPACE</kbd> Play again
        </div>
      </div>
    </aside>
  )
}
