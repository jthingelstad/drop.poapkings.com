// Mobile keeps its one-column body and fixed pill nav. Desktop uses a real
// viewport shell: persistent navigation and activity rails around a wider,
// independently scrolling stage. Game routes shed both rails but keep the same
// fixed-height stage and Falling Cards background.

import type { ComponentChildren } from 'preact'
import { route, navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { hasUnreadUpdates } from '../../lib/updates'
import { layout } from '../../lib/use-layout'
import Icon from '../Icon'
import KeyboardHelp from '../KeyboardHelp'
import DesktopAside from './DesktopAside'
import DesktopNav from './DesktopNav'
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
  const items = NAV_ITEMS

  if (onDesktop) {
    return (
      <div class="ed-app ed-app--desktop">
        <DesktopWallpaper />
        <div class={`ed-desktop${gaming ? ' ed-desktop--game' : ''}`}>
          {!gaming && <DesktopNav />}
          <main class="ed-desktop__main">{children}</main>
          {!gaming && <DesktopAside />}
        </div>
        <KeyboardHelp />
      </div>
    )
  }

  return (
    <div class="ed-app">
      <div class={`ed-mobile${gaming ? ' ed-mobile--game' : ''}`}>
        <main class={`ed-mobile__scroll${gaming ? ' ed-mobile__scroll--game' : ''}`}>{children}</main>
        {!gaming && <PillNav activeIdx={activeNavIndex(r, items)} items={items} />}
      </div>
    </div>
  )
}
