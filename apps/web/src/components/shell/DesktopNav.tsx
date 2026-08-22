// Desktop left rail: everything ABOUT the app — the wordmark, primary
// navigation, the ambient Falling Cards control, and the meta links. The right
// aside is the one thing that is HAPPENING. That split is why the live feed
// earns the height and the controls do not.
//
// There is deliberately no key-mapping block here. A rail teaches a mapping on
// a screen where it cannot be used; the letter on each keycap mid-run is the
// only place the mapping is stated, and `KeyboardHelp` (`?`) is the full
// reference for anyone who goes looking.

import { navigate, route } from '../../lib/router'
import { player } from '../../lib/account'
import { hasUnreadUpdates } from '../../lib/updates'
import { cycleDesktopFallingCards, desktopFallingCardsMode } from '../../lib/screensaver'
import { tapFxFrom } from '../../lib/tap-fx'
import Icon from '../Icon'
import PlayerAvatar from '../PlayerAvatar'
import Wordmark from '../brand/Wordmark'
import { NAV_ITEMS, activeNavIndex } from './nav'

const META_LINKS = [
  { label: 'About', href: '/about/' },
  { label: 'FAQ', href: '/faq/' },
  { label: 'Fair Play', href: '/fair-play/' },
  { label: 'Privacy', href: '/privacy/' }
]

export default function DesktopNav() {
  const active = activeNavIndex(route.value)
  const me = player.value
  const fallingCardsMode = desktopFallingCardsMode.value
  const fallingCardsNext =
    fallingCardsMode === 'off' ? 'Subtle' : fallingCardsMode === 'subtle' ? 'Background' : 'Full screen'

  return (
    <aside class="ed-desktop__rail" aria-label="Desktop navigation">
      <Wordmark className="ed-desktop__brand" />
      {me && (
        <button
          type="button"
          class="ed-desktop__me"
          aria-label={`${me.publicName} — ${me.xp.toLocaleString()} XP — open You`}
          onClick={() => navigate('/profile')}
        >
          <span class="ed-desktop__xp" aria-hidden="true">
            {me.xp.toLocaleString()} XP
          </span>
          <PlayerAvatar favoriteCardId={me.favoriteCardId} size="small" />
        </button>
      )}
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

      <div class="ed-rail-foot">
        <button
          class="ed-rail-btn ed-rail-btn--saver tap-fx"
          aria-label={`Falling Cards — ${fallingCardsNext.toLowerCase()}`}
          onClick={(e) => {
            tapFxFrom(e)
            cycleDesktopFallingCards()
          }}
        >
          <span class="tap-face">
            <Icon name="sparkles" />
            Falling Cards
            <span class="ed-rail-btn__hint">{fallingCardsNext} →</span>
          </span>
        </button>
        <div class="ed-rail-meta">
          {META_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </aside>
  )
}
