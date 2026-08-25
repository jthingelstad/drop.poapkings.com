import type { GameMode } from '@elixir-drop/contracts'
import type { GamePath } from './game-routes'
import type { Records } from '../types'
import { formatLeaderboardSeconds, formatSeconds } from './format'
import { GAME_CATALOG } from './game-catalog'

export interface GameInfo {
  mode: GameMode
  path: GamePath
  name: string
  // The emoji stays alongside the painted art: it is still the right thing in
  // plain-text contexts (the share text block, document.title, notifications)
  // where an <img> cannot go. `art` is what every VISUAL surface renders.
  icon: string
  art: string
  description: string
  // Practice is true practice: an endless drill that touches no competitive or
  // progression surface — no leaderboard, no leaderboard tab, no record, no XP.
  unranked?: boolean
}

// The six shipped modes.
export const GAMES: GameInfo[] = GAME_CATALOG.map((game) => ({ ...game }))

export const RANKED_GAMES = GAMES.filter((game) => !game.unranked)

// Display names/icons for every launched mode, so runs render consistently in
// activity lists and profiles.
const ALL_MODE_DISPLAY: Record<GameMode, { name: string; icon: string; art: string }> = {
  surge: { name: 'Surge', icon: '⚡', art: '/assets/modes/surge-192.png' },
  practice: { name: 'Practice', icon: '🎯', art: '/assets/modes/practice-192.png' },
  'higher-lower': { name: 'Higher / Lower', icon: '⚖️', art: '/assets/modes/higher-lower-192.png' },
  trade: { name: 'Trade', icon: '👑', art: '/assets/modes/trade-192.png' },
  survival: { name: 'Survival', icon: '💀', art: '/assets/modes/survival-192.png' },
  rain: { name: 'Rain', icon: '🌧️', art: '/assets/modes/rain-192.png' }
}

export function gameDisplay(mode: GameMode): { name: string; icon: string; art: string } {
  const game = GAME_BY_MODE.get(mode)
  return game ? { name: game.name, icon: game.icon, art: game.art } : ALL_MODE_DISPLAY[mode]
}

export const GAME_BY_MODE = new Map(GAMES.map((game) => [game.mode, game]))

export const LOWER_IS_BETTER = new Set<GameMode>(['surge', 'trade'])

type NumericRecordKey = Exclude<keyof Records, 'surgeBestPace'>

// Every mode that keeps a local personal best. Practice is excluded from the
// type itself — it is an endless drill with no score and no record, and having
// no key is what makes "write a practice best" unrepresentable rather than
// merely discouraged.
export type RecordedMode = Exclude<GameMode, 'practice'>

export function isRecordedMode(mode: GameMode): mode is RecordedMode {
  return mode !== 'practice'
}

export const RECORD_KEYS: Record<RecordedMode, NumericRecordKey> = {
  surge: 'surgeBest',
  'higher-lower': 'higherLowerContinuousBest',
  trade: 'tradeLadderBest',
  survival: 'survivalBest',
  rain: 'rainBest'
}

export function scoreLabel(mode: GameMode, score: number): string {
  if (LOWER_IS_BETTER.has(mode)) return `${formatSeconds(score)}s`
  // Practice reports accuracy, but only ever as a session stat on its own
  // summary — never as a record or a leaderboard row.
  if (mode === 'practice') return `${Math.round(score)}%`
  if (mode === 'rain') return `${Math.round(score)} cleared`
  // Higher/Lower runs on three lives, so its score is total correct reads, not
  // a streak. Survival is still sudden death, and still a streak.
  if (mode === 'higher-lower') return `${Math.round(score)} correct`
  return `${Math.round(score)} streak`
}

// Leaderboard rows already establish the selected mode, so Survival's card
// count needs no repeated "streak" suffix. Other count modes keep their
// distinct meaning (correct reads vs. cleared falling cards), while timed modes
// use the shared millisecond display contract.
export function leaderboardScoreLabel(mode: GameMode, score: number): string {
  if (LOWER_IS_BETTER.has(mode)) return `${formatLeaderboardSeconds(score)}s`
  if (mode === 'survival') return String(Math.round(score))
  return scoreLabel(mode, score)
}

export function scoreFromRecords(mode: GameMode, records: Records): number | undefined {
  return isRecordedMode(mode) ? (records[RECORD_KEYS[mode]] as number | undefined) : undefined
}

export function betterScore(mode: GameMode, candidate: number, current: number | undefined): boolean {
  return current === undefined || (LOWER_IS_BETTER.has(mode) ? candidate < current : candidate > current)
}

export function bestScoresFromRuns(
  runs: Array<{ mode: GameMode; score: number; seasonId: number }>,
  seasonId?: number
): Partial<Record<GameMode, number>> {
  const scores: Partial<Record<GameMode, number>> = {}
  for (const run of runs) {
    if (seasonId !== undefined && run.seasonId !== seasonId) continue
    if (betterScore(run.mode, run.score, scores[run.mode])) scores[run.mode] = run.score
  }
  return scores
}
