// Desktop shell — persistent 3-column app: left nav rail / center stage / right
// rail. Chosen at ≥1024px by lib/use-layout. The right rail dims during a game.

import type { ComponentChildren } from 'preact'
import { route, navigate } from '../../lib/router'
import { ELIXIR_DROP_DISCORD_URL } from '../../lib/links'
import { tapFxFrom } from '../../lib/tap-fx'
import { player, accountStatus, signOut } from '../../lib/account'
import { startScreensaver } from '../../lib/screensaver'
import { rankFor } from '../../data/starRanks'
import Icon from '../Icon'
import PlayerAvatar from '../PlayerAvatar'
import Wordmark from '../brand/Wordmark'
import DesktopRightRail from './DesktopRightRail'
import { NAV_ITEMS, isGameRoute } from './nav'

function LeftRail() {
  const r = route.value
  const current = player.value
  const authed = accountStatus.value === 'authenticated' && !!current
  const arena = current ? rankFor(current.xp ?? 0).current : null

  return (
    <aside class="ed-desktop__rail">
      <Wordmark className="ed-desktop__brand" />

      <nav class="ed-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.route}
            class="ed-nav__item"
            aria-current={item.matches(r) ? 'page' : undefined}
            onClick={() => navigate(item.route)}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
        <button
          class="ed-nav__item ed-nav__item--practice"
          aria-current={r.startsWith('/practice') ? 'page' : undefined}
          onClick={() => navigate('/practice')}
        >
          <Icon name="target" />
          Practice
          <span class="ed-nav__badge">Unranked</span>
        </button>
      </nav>

      <div class="ed-rail__foot">
        {authed && current ? (
          <>
            <button class="ed-rail-chip" onClick={() => navigate('/profile')}>
              <PlayerAvatar favoriteCardId={current.favoriteCardId} size="small" />
              <span class="ed-rail-chip__text">
                <span class="ed-rail-chip__name">{current.publicName ?? 'Player'}</span>
                <span class="ed-rail-chip__sub">{arena?.name ?? 'Player'}</span>
              </span>
            </button>
            <button
              class="ed-rail-btn ed-rail-btn--saver tap-fx"
              onClick={(e) => {
                tapFxFrom(e)
                startScreensaver('nav')
              }}
            >
              <span class="tap-face">
                <Icon name="sparkles" />
                Falling Cards
              </span>
            </button>
            <button
              class="ed-rail-btn ed-rail-btn--danger tap-fx"
              onClick={(e) => {
                tapFxFrom(e)
                signOut()
              }}
            >
              <span class="tap-face">
                <Icon name="log-out" />
                Sign out
              </span>
            </button>
          </>
        ) : (
          <button class="ed-rail-chip ed-rail-chip--guest tap-fx" onClick={() => navigate('/login')}>
            <span class="ed-rail-chip__avatar-guest" aria-hidden="true">
              <Icon name="user" />
            </span>
            <span class="ed-rail-chip__text">
              <span class="ed-rail-chip__name">Guest</span>
              <span class="ed-rail-chip__sub">Sign in to save</span>
            </span>
          </button>
        )}
      </div>

      <nav class="ed-railfoot" aria-label="About Elixir Drop">
        <button class="ed-railfoot__link" onClick={() => navigate('/about')}>
          About
        </button>
        <button class="ed-railfoot__link" onClick={() => navigate('/faq')}>
          FAQ
        </button>
        <button class="ed-railfoot__link" onClick={() => navigate('/privacy')}>
          Privacy
        </button>
        <a class="ed-railfoot__link" href={ELIXIR_DROP_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
          <Icon name="external-link" />
        </a>
      </nav>
    </aside>
  )
}

export default function DesktopShell({ children }: { children: ComponentChildren }) {
  const gaming = isGameRoute(route.value)
  return (
    <div class="ed-app">
      <div class={`ed-desktop${gaming ? ' ed-desktop--game' : ''}`}>
        <LeftRail />
        <main class="ed-desktop__main">{children}</main>
        <aside class="ed-desktop__right" style={{ opacity: gaming ? 0.32 : 1 }}>
          <DesktopRightRail />
        </aside>
      </div>
    </div>
  )
}
