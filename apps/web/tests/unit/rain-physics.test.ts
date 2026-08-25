import { describe, expect, it } from 'vitest'
import { rainLaneLeftPct, rainRecoveryShiftMs, rainVisualProgress } from '../../src/modes/rain/rain-physics'

describe('Rain physics', () => {
  it('moves linearly before easing into an exact impact deadline', () => {
    expect(rainVisualProgress(0, 10_000)).toBe(0)
    expect(rainVisualProgress(7_200, 10_000)).toBeCloseTo(0.72)
    expect(rainVisualProgress(9_000, 10_000)).toBeGreaterThan(0.9)
    expect(rainVisualProgress(10_000, 10_000)).toBe(1)

    const earlierStep = rainVisualProgress(9_000, 10_000) - rainVisualProgress(8_900, 10_000)
    const finalStep = rainVisualProgress(10_000, 10_000) - rainVisualProgress(9_900, 10_000)
    expect(finalStep).toBeLessThan(earlierStep)
  })

  it('places the same signed card round in the same lane', () => {
    const left = rainLaneLeftPct(26_000_001, 7)
    expect(rainLaneLeftPct(26_000_001, 7)).toBe(left)
    expect(rainLaneLeftPct(26_000_001, 8)).not.toBe(left)
    expect(left).toBeGreaterThanOrEqual(6)
    expect(left).toBeLessThanOrEqual(78)
  })

  it('shifts every survivor just enough to guarantee the recovery window', () => {
    expect(rainRecoveryShiftMs(10_000, [11_000, 12_500], 2_400)).toBe(1_400)
    expect(rainRecoveryShiftMs(10_000, [12_500, 14_000], 2_400)).toBe(0)
    expect(rainRecoveryShiftMs(10_000, [], 2_400)).toBe(0)
  })
})
