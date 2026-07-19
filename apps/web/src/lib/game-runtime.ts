export type GameRuntimeStage = 'ready' | 'countdown' | 'running' | 'summary' | 'over'

export type GameRuntimeCueType =
  | 'run-countdown'
  | 'run-start'
  | 'answer-correct'
  | 'answer-wrong'
  | 'round-advance'
  | 'penalty'
  | 'run-complete'
  | 'restart'

export interface GameRuntimeCue<TDetail = unknown> {
  id: number
  type: GameRuntimeCueType
  atMs: number
  detail?: TDetail
}

const ALLOWED_STAGE_TRANSITIONS: Record<GameRuntimeStage, ReadonlySet<GameRuntimeStage>> = {
  ready: new Set(['countdown', 'running']),
  countdown: new Set(['ready', 'running']),
  running: new Set(['ready', 'summary', 'over']),
  summary: new Set(['ready', 'running']),
  over: new Set(['ready', 'running'])
}

export function transitionGameRuntimeStage(current: GameRuntimeStage, next: GameRuntimeStage): GameRuntimeStage {
  if (current === next) return current
  if (!ALLOWED_STAGE_TRANSITIONS[current].has(next)) {
    throw new Error(`Invalid game runtime transition: ${current} -> ${next}`)
  }
  return next
}

export function createGameRuntimeCue<TDetail>(
  id: number,
  type: GameRuntimeCueType,
  atMs: number,
  detail?: TDetail
): GameRuntimeCue<TDetail> {
  return detail === undefined ? { id, type, atMs } : { id, type, atMs, detail }
}
