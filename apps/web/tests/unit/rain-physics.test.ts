import { describe, expect, it } from 'vitest'
import { rainDifficultyProgress } from '@elixir-drop/contracts'
import {
  RAIN_FRAGMENT_CLIP_PATHS,
  RAIN_SLOW_ZONE_START,
  rainFallBoost,
  rainFallProgress,
  rainFallTimeLeftMs,
  rainFallTotalDurationMs,
  rainTileTopPx
} from '../../src/modes/rain/rain-physics'

describe('Rain physics', () => {
  it('falls normally through 90%, then decelerates into the line', () => {
    const linearDurationMs = 10_000
    expect(rainFallProgress(0, linearDurationMs)).toBe(0)
    expect(rainFallProgress(8_000, linearDurationMs)).toBeCloseTo(0.8)
    expect(rainFallProgress(9_000, linearDurationMs)).toBe(RAIN_SLOW_ZONE_START)
    expect(rainFallProgress(10_000, linearDurationMs)).toBeCloseTo(0.975)
    expect(rainFallProgress(11_000, linearDurationMs)).toBe(1)
    expect(rainFallTotalDurationMs(linearDurationMs)).toBe(11_000)
    expect(rainFallTimeLeftMs(9_000, linearDurationMs)).toBe(2_000)

    const stepBefore = rainFallProgress(9_000, linearDurationMs) - rainFallProgress(8_900, linearDurationMs)
    const firstSlowStep = rainFallProgress(9_100, linearDurationMs) - rainFallProgress(9_000, linearDurationMs)
    const finalStep = rainFallProgress(11_000, linearDurationMs) - rainFallProgress(10_900, linearDurationMs)
    expect(firstSlowStep).toBeCloseTo(stepBefore, 3)
    expect(finalStep).toBeLessThan(firstSlowStep / 10)
  })

  it('puts the card bottom exactly on the kill line at impact on every field height', () => {
    for (const [tileHeight, killLineOffset] of [
      [100, 420],
      [118, 612],
      [96, 300]
    ]) {
      const top = rainTileTopPx(1, tileHeight, killLineOffset)
      expect(top + tileHeight).toBe(killLineOffset)
    }
  })

  it('halves both late difficulty progress and fall-speed growth after 80 clears', () => {
    expect(rainDifficultyProgress(79)).toBe(79)
    expect(rainDifficultyProgress(80)).toBe(80)
    expect(rainDifficultyProgress(81)).toBe(80.5)
    expect(rainDifficultyProgress(100)).toBe(90)

    const fullStep = rainFallBoost(80) - rainFallBoost(79)
    const lateStep = rainFallBoost(81) - rainFallBoost(80)
    expect(lateStep / fullStep).toBeCloseTo(0.5, 2)
  })

  it('splits a failed card into distinct Motion fragments', () => {
    expect(RAIN_FRAGMENT_CLIP_PATHS).toHaveLength(8)
    expect(new Set(RAIN_FRAGMENT_CLIP_PATHS).size).toBe(RAIN_FRAGMENT_CLIP_PATHS.length)
  })
})
