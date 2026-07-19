import type { GameMode } from '@elixir-drop/contracts'
import type { GamePath } from './game-routes'
import type { Records } from '../types'

export interface GameInfo {
  mode: GameMode
  path: GamePath
  name: string
  icon: string
  description: string
}

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
    description: 'Learn elixir costs at your own pace — no clock.'
  },
  { mode: 'identify', path: '/identify', name: 'Identify', icon: '🔎', description: 'See the art. Pick the card.' },
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
    mode: 'ladder',
    path: '/ladder',
    name: 'Speed Ladder',
    icon: '↕️',
    description: 'Sort five cards from cheap to expensive.'
  },
  {
    mode: 'endless-ladder',
    path: '/endless-ladder',
    name: 'Endless Ladder',
    icon: '➕',
    description: 'Insert each new card into the growing ladder.'
  },
  {
    mode: 'cost-sweep',
    path: '/cost-sweep',
    name: 'Cost Sweep',
    icon: '🧹',
    description: 'Tap every card matching the target elixir cost.'
  },
  { mode: 'blitz', path: '/blitz', name: 'Blitz', icon: '⏱️', description: '60 seconds — how many can you clear?' },
  {
    mode: 'survival',
    path: '/survival',
    name: 'Survival',
    icon: '💀',
    description: 'Sudden death — one miss ends the run.'
  }
]

export const GAME_BY_MODE = new Map(GAMES.map((game) => [game.mode, game]))

export const LOWER_IS_BETTER = new Set<GameMode>(['surge', 'identify', 'trade', 'ladder'])

type NumericRecordKey = Exclude<keyof Records, 'surgeBestPace'>

export const RECORD_KEYS: Record<GameMode, NumericRecordKey> = {
  surge: 'surgeBest',
  practice: 'bestAccuracy',
  identify: 'identifyBest',
  'higher-lower': 'longestStreak',
  trade: 'tradeBest',
  ladder: 'ladderBest',
  'endless-ladder': 'endlessLadderBest',
  'cost-sweep': 'costSweepBest',
  blitz: 'blitzBest',
  survival: 'survivalBest'
}

export function scoreLabel(mode: GameMode, score: number): string {
  if (LOWER_IS_BETTER.has(mode)) return `${(score / 1_000).toFixed(2)}s`
  if (mode === 'practice') return `${Math.round(score)}%`
  if (mode === 'blitz' || mode === 'cost-sweep') return `${Math.round(score)} cards`
  if (mode === 'endless-ladder') return `${Math.round(score)} inserts`
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
