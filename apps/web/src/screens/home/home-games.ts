// Every game on Home, in one fixed order — read by ONE component on both
// shells, which is a stronger version of what this comment used to argue for
// when there were two layouts to keep in step. The order never changes, because
// a player looking for Survival should find it in the same place every day.
//
// Promotion is the hero's job, not this list's: one game is featured at the top
// each day and every game still sits here, so the rotation can never make a
// mode harder to find.

import { featuredModeForDate, type GameMode } from '@elixir-drop/contracts'

export interface HomeGame {
  key: string
  name: string
  desc: string
  path: string
  mode: GameMode
  badge?: string
}

export const ALL_GAMES: HomeGame[] = [
  {
    key: 'surge',
    name: 'Surge',
    desc: '15 cards. Name each elixir cost against the clock.',
    path: '/surge',
    mode: 'surge'
  },
  {
    key: 'higher-lower',
    name: 'Higher / Lower',
    desc: 'Two cards, one call — which costs more elixir? 3 lives, and the clock tightens.',
    path: '/higher-lower',
    mode: 'higher-lower'
  },
  {
    key: 'rain',
    name: 'Rain',
    desc: 'Cards fall from the sky. Clear each cost before it lands. 3 lives.',
    path: '/rain',
    mode: 'rain'
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

// Today's featured game, by UTC day so every player sees the same one and it
// turns over at a single predictable moment. Deliberately not random: the
// sequence repeats every five days, which is a rotation a regular can learn.
export function featuredGame(now: Date = new Date()): HomeGame {
  return ALL_GAMES.find((game) => game.mode === featuredModeForDate(now))!
}
