// Shared primary-navigation model for both shells. Live player data has no
// offline snapshot, so the connected navigation (Games / Ranks / You) becomes
// Games / Offline while the browser is definitely disconnected.

import type { IconName } from '../Icon'

export interface NavItem {
  route: string
  // Which routes count as "on" this tab (prefix match). Home matches only '/'.
  matches: (r: string) => boolean
  icon: IconName
  label: string
  shortLabel: string
}

const GAMES_ITEM: NavItem = {
  route: '/',
  matches: (r) => r === '/' || r === '/practice' || isGameRoute(r),
  icon: 'gamepad',
  label: 'Games',
  shortLabel: 'Games'
}

export const NAV_ITEMS: NavItem[] = [
  GAMES_ITEM,
  {
    route: '/leaderboards',
    matches: (r) => r.startsWith('/leaderboards') || r.startsWith('/players/'),
    icon: 'trophy',
    label: 'Leaderboards',
    shortLabel: 'Ranks'
  },
  {
    route: '/profile',
    matches: (r) => r.startsWith('/profile') || isMoreRoute(r),
    icon: 'user',
    label: 'Profile',
    shortLabel: 'You'
  }
]

export const OFFLINE_NAV_ITEMS: NavItem[] = [
  GAMES_ITEM,
  {
    route: '/offline',
    // Direct links to either live player surface still render the bundled
    // offline explanation, so keep Offline selected there too.
    matches: (r) => r.startsWith('/offline') || r.startsWith('/leaderboards') || r.startsWith('/profile'),
    icon: 'wifi-off',
    label: 'Offline mode',
    shortLabel: 'Offline'
  }
]

const GAME_PREFIXES = ['/surge', '/practice', '/higher-lower', '/trade', '/survival', '/rain']

// App Info and Settings are the in-app pages reached from Profile's More list.
// The public text pages leave the app shell and therefore do not participate in
// this navigation state.
const MORE_PREFIXES = ['/app-info', '/settings']

export function isMoreRoute(r: string): boolean {
  return MORE_PREFIXES.some((p) => r.startsWith(p))
}

// Home owns the game routes so the Games tab stays lit while playing. Also used
// by the shells to hide the nav / dim the rail during a game.
export function isGameRoute(r: string): boolean {
  // `/practice` is a section hub, so it keeps the ordinary shell and mobile
  // navigation. Only a selected drill becomes the full-bleed game surface.
  return r !== '/practice' && GAME_PREFIXES.some((p) => r.startsWith(p))
}

// Falls back to Games only for genuinely unclaimed routes. Every route a player
// can reach from the nav should be claimed by the tab it was opened from —
// falling through to 0 is what silently moved the pill to Games while someone
// read About from the You tab.
export function activeNavIndex(r: string, items: readonly NavItem[] = NAV_ITEMS): number {
  const i = items.findIndex((item) => item.matches(r))
  return i === -1 ? 0 : i
}
