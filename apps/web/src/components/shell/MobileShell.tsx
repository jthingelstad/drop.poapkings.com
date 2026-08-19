// The one true shell — a single-column scroll body with a fixed bottom pill nav
// and a sliding active indicator. Nav is hidden during a game so play areas are
// full-bleed. On mobile it is the full-bleed shell; at or above 1024px the same
// column is centered and letterboxed on the dark field (lib/use-layout) and a
// slim aside fills the margin with the live Recent runs feed + the Falling Cards
// launcher, over Falling Cards drifting as ambient wallpaper. There is no
// separate desktop shell any more.

import type { ComponentChildren } from 'preact'
import { route, navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { hasUnreadUpdates } from '../../lib/updates'
import { layout, isRankedTouchGate } from '../../lib/use-layout'
import Icon from '../Icon'
import DesktopAside from './DesktopAside'
import DesktopWallpaper from './DesktopWallpaper'
import { NAV_ITEMS, activeNavIndex, isGameRoute, type NavItem } from './nav'

function PillNav({ activeIdx, items }: { activeIdx: number; items: readonly NavItem[] }) {
  return (
    <nav class="ed-pillnav" aria-label="Primary">
      <div class="ed-pillnav__track">
        <span
          class="ed-pillnav__ind"
          style={{ width: `calc((100% - 10px) / ${items.length})`, transform: `translateX(${activeIdx * 100}%)` }}
          aria-hidden="true"
        />
        {items.map((item, i) => (
          <button
            key={item.route}
            class="ed-pillnav__btn tap-fx"
            aria-current={i === activeIdx ? 'page' : undefined}
            onClick={(e) => {
              tapFxFrom(e)
              navigate(item.route)
            }}
          >
            <span class="tap-face">
              {item.route === '/profile' && hasUnreadUpdates.value && (
                <span class="ed-nav-dot" aria-label="Unread updates" />
              )}
              <Icon name={item.icon} />
              {item.shortLabel}
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}

export default function MobileShell({ children }: { children: ComponentChildren }) {
  const r = route.value
  const gaming = isGameRoute(r)
  const onDesktop = layout.value === 'desktop'
  // The margin's wallpaper. Off during a game (already full-bleed) and off on
  // the ranked gate — nothing ambient behind a screen asking for a decision.
  const ambient = onDesktop && !gaming && !isRankedTouchGate(r)
  const items = NAV_ITEMS
  return (
    <div class={`ed-app${onDesktop ? ' ed-app--letterbox' : ''}`}>
      {ambient && <DesktopWallpaper />}
      <div class={`ed-mobile${gaming ? ' ed-mobile--game' : ''}`}>
        <main class={`ed-mobile__scroll${gaming ? ' ed-mobile__scroll--game' : ''}`}>{children}</main>
        {!gaming && <PillNav activeIdx={activeNavIndex(r, items)} items={items} />}
      </div>
      {/* Desktop letterbox margin. Off on mobile and during a game (full-bleed). */}
      {onDesktop && !gaming && <DesktopAside />}
    </div>
  )
}
