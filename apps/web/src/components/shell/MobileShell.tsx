// Mobile shell — single-column scroll body with a fixed bottom pill nav
// (Games / Ranks / You) and a sliding active indicator. Nav is hidden during a
// game so play areas are full-bleed. Chosen below 1024px by lib/use-layout.

import type { ComponentChildren } from 'preact'
import { route, navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import Icon from '../Icon'
import { NAV_ITEMS, activeNavIndex, isGameRoute } from './nav'

function PillNav({ activeIdx }: { activeIdx: number }) {
  return (
    <nav class="ed-pillnav" aria-label="Primary">
      <div class="ed-pillnav__track">
        <span class="ed-pillnav__ind" style={{ transform: `translateX(${activeIdx * 100}%)` }} aria-hidden="true" />
        {NAV_ITEMS.map((item, i) => (
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
  return (
    <div class="ed-app">
      <div class="ed-mobile">
        <main class={`ed-mobile__scroll${gaming ? ' ed-mobile__scroll--game' : ''}`}>{children}</main>
        {!gaming && <PillNav activeIdx={activeNavIndex(r)} />}
      </div>
    </div>
  )
}
