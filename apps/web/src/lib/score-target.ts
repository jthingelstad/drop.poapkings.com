import { GAME_CATALOG } from './game-catalog'
import { isRecordedMode, LOWER_IS_BETTER, scoreLabel, type RecordedMode } from './game-metadata'
import { routePathname, routeQuery } from './router'

export function scoreTarget(value: string) {
  const mode = GAME_CATALOG.find((game) => game.path === routePathname(value))?.mode
  const raw = new URLSearchParams(routeQuery(value)).get('target')
  if (!mode || !isRecordedMode(mode) || !raw || !/^\d{1,10}$/.test(raw)) return null
  return { mode, score: Number(raw) }
}

export function targetResult(mode: RecordedMode, target: number, result: number): string {
  const margin = LOWER_IS_BETTER.has(mode) ? target - result : result - target
  if (margin === 0) return 'You tied the target!'
  const amount = Math.abs(margin)
  const units = mode === 'higher-lower' ? 'read' : 'card'
  const difference = LOWER_IS_BETTER.has(mode)
    ? scoreLabel(mode, amount)
    : `${amount} ${units}${amount === 1 ? '' : 's'}`
  return margin > 0 ? `You beat the target by ${difference}!` : `${difference} to match the target.`
}
