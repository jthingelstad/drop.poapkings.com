import { rainDifficultyProgress } from '@elixir-drop/contracts'

export const RAIN_SLOW_ZONE_START = 0.9
export const RAIN_SLOW_ZONE_TIME_SCALE = 2

const RAIN_FALL_LINEAR = 0.011
const RAIN_FALL_QUAD = 0.00003

// The first 90% keeps Rain's original linear pace. The final 10% takes twice
// its linear time and decelerates continuously from the incoming speed to zero.
// That makes the slowdown visible without a speed jump at the zone boundary.
export function rainFallTotalDurationMs(linearDurationMs: number): number {
  const duration = Math.max(0, linearDurationMs)
  return duration * (RAIN_SLOW_ZONE_START + (1 - RAIN_SLOW_ZONE_START) * RAIN_SLOW_ZONE_TIME_SCALE)
}

export function rainFallProgress(elapsedMs: number, linearDurationMs: number): number {
  if (linearDurationMs <= 0) return 1
  const elapsed = Math.max(0, elapsedMs)
  const linearZoneMs = linearDurationMs * RAIN_SLOW_ZONE_START
  if (elapsed <= linearZoneMs) return elapsed / linearDurationMs

  const slowZoneMs = linearDurationMs * (1 - RAIN_SLOW_ZONE_START) * RAIN_SLOW_ZONE_TIME_SCALE
  const slowProgress = Math.min(1, (elapsed - linearZoneMs) / slowZoneMs)
  // Hermite segment with an entering slope of 2 and an ending slope of 0.
  // Because the segment lasts 2x as long, its starting screen velocity exactly
  // matches the linear zone before easing to rest at the line.
  const easedSlowProgress = 2 * slowProgress - slowProgress * slowProgress
  return RAIN_SLOW_ZONE_START + (1 - RAIN_SLOW_ZONE_START) * easedSlowProgress
}

export function rainFallTimeLeftMs(elapsedMs: number, linearDurationMs: number): number {
  return Math.max(0, rainFallTotalDurationMs(linearDurationMs) - Math.max(0, elapsedMs))
}

// A tile starts with its bottom edge at the top of the field and finishes with
// that same edge exactly on the kill line. Field height changes only the pixel
// distance rendered; it never changes the progress clock or answer window.
export function rainTileTopPx(progress: number, tileHeightPx: number, killLineOffsetPx: number): number {
  const boundedProgress = Math.max(0, Math.min(1, progress))
  return killLineOffsetPx * boundedProgress - tileHeightPx
}

export function rainFallBoost(cleared: number): number {
  const difficulty = rainDifficultyProgress(cleared)
  return difficulty * RAIN_FALL_LINEAR + difficulty * difficulty * RAIN_FALL_QUAD
}

export const RAIN_FRAGMENT_CLIP_PATHS = [
  'polygon(0 0, 48% 0, 44% 28%, 0 35%)',
  'polygon(48% 0, 100% 0, 100% 30%, 44% 28%)',
  'polygon(0 35%, 44% 28%, 48% 55%, 0 60%)',
  'polygon(44% 28%, 100% 30%, 100% 58%, 48% 55%)',
  'polygon(0 60%, 48% 55%, 42% 80%, 0 84%)',
  'polygon(48% 55%, 100% 58%, 100% 82%, 42% 80%)',
  'polygon(0 84%, 42% 80%, 50% 100%, 0 100%)',
  'polygon(42% 80%, 100% 82%, 100% 100%, 50% 100%)'
] as const
