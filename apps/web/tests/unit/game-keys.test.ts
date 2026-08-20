import { describe, expect, it } from 'vitest'
import { costForGameKey, isSpaceKey, shortcutForCost } from '../../src/lib/game-keys'

describe('desktop game keys', () => {
  it.each([
    ['KeyA', 'a', 1],
    ['KeyS', 's', 2],
    ['KeyD', 'd', 3],
    ['KeyF', 'f', 4],
    ['KeyG', 'g', 5],
    ['KeyJ', 'j', 6],
    ['KeyK', 'k', 7],
    ['KeyL', 'l', 8],
    ['Semicolon', ';', 9]
  ])('maps %s to cost %s', (code, key, cost) => {
    expect(costForGameKey({ code, key })).toBe(cost)
  })

  it('keeps 1-9 as aliases and rejects unrelated keys', () => {
    expect(costForGameKey({ code: 'Digit7', key: '7' })).toBe(7)
    expect(costForGameKey({ code: 'KeyQ', key: 'q' })).toBeNull()
  })

  it('publishes the same labels rendered on the keycaps', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(shortcutForCost)).toEqual(['A', 'S', 'D', 'F', 'G', 'J', 'K', 'L', ';'])
  })

  it('recognizes modern and legacy Space values', () => {
    expect(isSpaceKey({ code: 'Space', key: ' ' })).toBe(true)
    expect(isSpaceKey({ code: '', key: 'Spacebar' })).toBe(true)
  })
})
