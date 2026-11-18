import { expect, it } from 'vitest'
import { scoreTarget, targetResult } from '../../src/lib/score-target'

it('only accepts integer targets on scored game routes', () => {
  expect(scoreTarget('/survival?target=0')).toEqual({ mode: 'survival', score: 0 })
  for (const route of ['/survival', '/practice?target=10', '/surge?target=-1', '/surge?target=x', '/trade?target=0.5'])
    expect(scoreTarget(route)).toBeNull()
})

it('compares times and counts in the direction the game scores', () => {
  expect(targetResult('trade', 12345, 12340)).toBe('You beat the target by 0.005s!')
  expect(targetResult('surge', 12345, 12350)).toBe('0.005s to match the target.')
  expect(targetResult('higher-lower', 12, 13)).toBe('You beat the target by 1 read!')
  expect(targetResult('rain', 6, 4)).toBe('2 cards to match the target.')
  expect(targetResult('survival', 3, 3)).toBe('You tied the target!')
})
