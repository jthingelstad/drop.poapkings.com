import { afterEach, describe, expect, it } from 'vitest'
import {
  costForGameKey,
  isSpaceKey,
  keyLegendForCost,
  keyLegendRow,
  resetKeyLegendForTests,
  resolveKeyLegend,
  shortcutForCost
} from '../../src/lib/game-keys'

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

// The binding is positional, so the US letter is a GUESS about what is printed
// under the player's finger. Chromium can answer it exactly; a wrong letter is
// worse than a generic one, so nothing is substituted on anything less.
describe('the legend printed on a keycap', () => {
  afterEach(resetKeyLegendForTests)

  it('shows the US letters until a browser resolves the real layout', () => {
    expect(keyLegendRow()).toEqual(['A', 'S', 'D', 'F', 'G', 'J', 'K', 'L', ';'])
  })

  it("prints the player's own legend once getLayoutMap resolves it", async () => {
    // AZERTY: the home row is q s d f g, and the key right of L is m.
    await resolveKeyLegend({
      getLayoutMap: async () =>
        new Map([
          ['KeyA', 'q'],
          ['KeyS', 's'],
          ['KeyD', 'd'],
          ['KeyF', 'f'],
          ['KeyG', 'g'],
          ['KeyJ', 'j'],
          ['KeyK', 'k'],
          ['KeyL', 'l'],
          ['Semicolon', 'm']
        ])
    })
    expect(keyLegendRow()).toEqual(['Q', 'S', 'D', 'F', 'G', 'J', 'K', 'L', 'M'])
    // The BINDING never moves: physical KeyA is still cost 1 on AZERTY.
    expect(costForGameKey({ code: 'KeyA', key: 'q' })).toBe(1)
  })

  it('keeps the US fallback where the browser has no answer, or a useless one', async () => {
    await resolveKeyLegend(undefined)
    expect(keyLegendForCost(1)).toBe('A')

    await resolveKeyLegend({
      getLayoutMap: async () => {
        throw new Error('not allowed')
      }
    })
    expect(keyLegendForCost(1)).toBe('A')

    // A blank or multi-character legend is not a keycap label.
    await resolveKeyLegend({
      getLayoutMap: async () =>
        new Map([
          ['KeyA', '  '],
          ['KeyS', 'Dead']
        ])
    })
    expect(keyLegendForCost(1)).toBe('A')
    expect(keyLegendForCost(2)).toBe('S')
  })
})
