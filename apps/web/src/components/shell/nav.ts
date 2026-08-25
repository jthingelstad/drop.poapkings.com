// Shared primary-navigation model for both shells: Play · Ladder · You. The nav
// never renames itself — offline or online, the tabs are the same. A state that
// changes (offline, guest) is named by a header chip on the page, not by
// rewriting a control. The tabs stay put so muscle memory does.

import type { IconName } from '../Icon'
import { routePathname } from '../../lib/router'

export interface NavItem {
  route: string
  // Which exact routes count as "on" this tab. Home matches only '/'.
  matches: (r: string) => boolean
  icon: IconName
  label: string
  shortLabel: string
}

const GAMES_ITEM: NavItem = {
  route: '/',
  matches: (r) => routePathname(r) === '/' || isGameRoute(r),
  icon: 'gamepad',
  label: 'Play',
  shortLabel: 'Play'
}

// Play · Ladder · You. "Ladder" is what Clash players call the climb: it is
// short enough for the pill and already the app's word for badge ladders, so
// boards, rungs and clan all sit under it. The route stays `/leaderboards`.
export const NAV_ITEMS: NavItem[] = [
  GAMES_ITEM,
  {
    route: '/leaderboards',
    matches: (r) => routePathname(r) === '/leaderboards' || routePathname(r).startsWith('/players/'),
    icon: 'trophy',
    label: 'Ladder',
    shortLabel: 'Ladder'
  },
  {
    route: '/profile',
    matches: (r) => routePathname(r) === '/profile' || isMoreRoute(r),
    icon: 'user',
    label: 'You',
    shortLabel: 'You'
  }
]

const GAME_PREFIXES = ['/surge', '/practice', '/higher-lower', '/trade', '/survival', '/rain']

// App Info is the in-app page reached from Profile's More list.
// The public text pages leave the app shell and therefore do not participate in
// this navigation state.
const MORE_ROUTES = new Set(['/app-info'])

export function isMoreRoute(r: string): boolean {
  return MORE_ROUTES.has(routePathname(r))
}

// Home owns the game routes so the Games tab stays lit while playing. Also used
// by the shells to hide the nav / dim the rail during a game.
export function isGameRoute(r: string): boolean {
  return GAME_PREFIXES.includes(routePathname(r))
}

// Falls back to Games only for genuinely unclaimed routes. Every route a player
// can reach from the nav should be claimed by the tab it was opened from —
// falling through to 0 is what silently moved the pill to Games while someone
// read About from the You tab.
export function activeNavIndex(r: string, items: readonly NavItem[] = NAV_ITEMS): number {
  const i = items.findIndex((item) => item.matches(r))
  return i === -1 ? 0 : i
}
