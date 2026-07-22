import type { GameMode } from '@elixir-drop/contracts'
import type { GamePath } from './game-routes'
import type { Records } from '../types'

export interface GameInfo {
  mode: GameMode
  path: GamePath
  name: string
  icon: string
  description: string
  // Practice is true practice: runs record to history but never place on a
  // leaderboard, and the mode has no leaderboard tab.
  unranked?: boolean
}

// The six shipped modes.
export const GAMES: GameInfo[] = [
  {
    mode: 'surge',
    path: '/surge',
    name: 'Surge',
    icon: '⚡',
    description: '15 cards. Name each elixir cost against the clock.'
  },
  {
    mode: 'practice',
    path: '/practice',
    name: 'Practice',
    icon: '🎯',
    description: 'Learn elixir costs at your own pace — no clock, no rankings.',
    unranked: true
  },
  {
    mode: 'higher-lower',
    path: '/higher-lower',
    name: 'Higher / Lower',
    icon: '⚖️',
    description: 'Two cards — which one costs more?'
  },
  {
    mode: 'trade',
    path: '/trade',
    name: 'Trade',
    icon: '👑',
    description: 'Read the elixir trade from Blue King side.'
  },
  {
    mode: 'survival',
    path: '/survival',
    name: 'Survival',
    icon: '💀',
    description: 'Sudden death — one miss ends the run.'
  },
  {
    mode: 'rain',
    path: '/rain',
    name: 'Rain',
    icon: '🌧️',
    description: 'Cards fall from the sky — clear each cost before it lands. 3 lives.'
  }
]

export const RANKED_GAMES = GAMES.filter((game) => !game.unranked)

// Display names/icons for every launched mode, so runs render consistently in
// activity lists and profiles.
const ALL_MODE_DISPLAY: Record<GameMode, { name: string; icon: string }> = {
  surge: { name: 'Surge', icon: '⚡' },
  practice: { name: 'Practice', icon: '🎯' },
  'higher-lower': { name: 'Higher / Lower', icon: '⚖️' },
  trade: { name: 'Trade', icon: '👑' },
  survival: { name: 'Survival', icon: '💀' },
  rain: { name: 'Rain', icon: '🌧️' }
}

export function gameDisplay(mode: GameMode): { name: string; icon: string } {
  const game = GAME_BY_MODE.get(mode)
  return game ? { name: game.name, icon: game.icon } : ALL_MODE_DISPLAY[mode]
}

export const GAME_BY_MODE = new Map(GAMES.map((game) => [game.mode, game]))

export const LOWER_IS_BETTER = new Set<GameMode>(['surge', 'trade'])

type NumericRecordKey = Exclude<keyof Records, 'surgeBestPace'>

export const RECORD_KEYS: Record<GameMode, NumericRecordKey> = {
  surge: 'surgeBest',
  practice: 'bestAccuracy',
  'higher-lower': 'longestStreak',
  trade: 'tradeBest',
  survival: 'survivalBest',
  rain: 'rainBest'
}

export function scoreLabel(mode: GameMode, score: number): string {
  if (LOWER_IS_BETTER.has(mode)) return `${(score / 1_000).toFixed(2)}s`
  if (mode === 'practice') return `${Math.round(score)}%`
  if (mode === 'rain') return `${Math.round(score)} cleared`
  return `${Math.round(score)} streak`
}

export function scoreFromRecords(mode: GameMode, records: Records): number | undefined {
  return records[RECORD_KEYS[mode]] as number | undefined
}

export function betterScore(mode: GameMode, candidate: number, current: number | undefined): boolean {
  return current === undefined || (LOWER_IS_BETTER.has(mode) ? candidate < current : candidate > current)
}

export function bestScoresFromRuns(
  runs: Array<{ mode: GameMode; score: number; seasonId: string }>,
  seasonId?: string
): Partial<Record<GameMode, number>> {
  const scores: Partial<Record<GameMode, number>> = {}
  for (const run of runs) {
    if (seasonId && run.seasonId !== seasonId) continue
    if (betterScore(run.mode, run.score, scores[run.mode])) scores[run.mode] = run.score
  }
  return scores
}
