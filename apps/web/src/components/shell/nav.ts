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
    matches: (r) => r.startsWith('/leaderboards'),
    icon: 'trophy',
    label: 'Leaderboards',
    shortLabel: 'Ranks'
  },
  {
    route: '/profile',
    matches: (r) => r.startsWith('/profile'),
    icon: 'user',
    label: 'Profile',
    shortLabel: 'You'
  }
]

const GAME_PREFIXES = ['/surge', '/practice', '/higher-lower', '/trade', '/survival', '/rain']

// Home owns the game routes so the Games tab stays lit while playing. Also used
// by the shells to hide the nav / dim the rail during a game.
export function isGameRoute(r: string): boolean {
  return GAME_PREFIXES.some((p) => r.startsWith(p))
}

export function activeNavIndex(r: string): number {
  const i = NAV_ITEMS.findIndex((item) => item.matches(r))
  return i === -1 ? 0 : i
}
