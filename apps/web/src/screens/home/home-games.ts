// The "More games" cards on Home (everything except the Surge hero), in one
// order shared by both layouts — mobile swipe row and desktop 2×2 grid. Rain
// sits 2nd, as designed. Rain is not a real GameMode until Phase 5, so it is
// modeled here as a static card pointing at a themed placeholder route.

import type { GameMode } from '@elixir-drop/contracts'

export interface MoreGame {
  key: string
  name: string
  desc: string
  path: string
  // Ranked modes read their #1 champion from the live board; Rain has none yet.
  mode?: GameMode
  badge?: string
  // Purple accent = the featured/new card (Rain), matching the prototype.
  accent?: boolean
}

export const MORE_GAMES: MoreGame[] = [
  {
    key: 'higher-lower',
    name: 'Higher / Lower',
    desc: 'Two cards, one call — which costs more elixir? Keep the streak alive.',
    path: '/higher-lower',
    mode: 'higher-lower'
  },
  {
    key: 'rain',
    name: 'Rain',
    desc: 'Cards fall from the sky. Clear each cost before it lands. 3 lives.',
    path: '/rain',
    mode: 'rain',
    badge: 'NEW',
    accent: true
  },
  {
    key: 'trade',
    name: 'Trade',
    desc: 'Read the swing from your side — are you up, down, or dead even?',
    path: '/trade',
    mode: 'trade'
  },
  {
    key: 'survival',
    name: 'Survival',
    desc: 'Sudden death. One wrong cost and the run is over.',
    path: '/survival',
    mode: 'survival'
  }
]
