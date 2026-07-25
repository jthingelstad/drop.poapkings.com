// Shared primary-navigation model for both shells. Mobile shows short labels
// (Games / Ranks / You); desktop shows full labels. Same routes, same order.

import type { IconName } from '../Icon'

export interface NavItem {
  route: string
  // Which routes count as "on" this tab (prefix match). Home matches only '/'.
  matches: (r: string) => boolean
  icon: IconName
  label: string
  shortLabel: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    route: '/',
    matches: (r) => r === '/' || isGameRoute(r),
    icon: 'gamepad',
    label: 'Games',
    shortLabel: 'Games'
  },
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

const GAME_PREFIXES = ['/surge', '/practice', '/higher-lower', '/trade', '/survival', '/rain']

// The meta pages reached from Profile's "More" list (and Settings, reached from
// the same screen). They belong to the You tab: the pill has to stay where the
// player came from, or reading About looks like it navigated them into Games.
const MORE_PREFIXES = ['/about', '/releases', '/faq', '/install', '/privacy', '/settings']

export function isMoreRoute(r: string): boolean {
  return MORE_PREFIXES.some((p) => r.startsWith(p))
}

// Home owns the game routes so the Games tab stays lit while playing. Also used
// by the shells to hide the nav / dim the rail during a game.
export function isGameRoute(r: string): boolean {
  return GAME_PREFIXES.some((p) => r.startsWith(p))
}

// Falls back to Games only for genuinely unclaimed routes. Every route a player
// can reach from the nav should be claimed by the tab it was opened from —
// falling through to 0 is what silently moved the pill to Games while someone
// read About from the You tab.
export function activeNavIndex(r: string): number {
  const i = NAV_ITEMS.findIndex((item) => item.matches(r))
  return i === -1 ? 0 : i
}
