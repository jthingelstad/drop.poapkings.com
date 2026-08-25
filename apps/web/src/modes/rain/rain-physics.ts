const RAIN_EASE_START = 0.72

// Rain falls linearly for most of the field, then uses a cubic Hermite segment
// whose starting velocity is still 1 and whose ending velocity is 0. The card
// therefore slows into the kill line without a visible speed jump, while the
// logical deadline remains unchanged.
export function rainVisualProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs))
  if (progress <= RAIN_EASE_START) return progress

  const lateProgress = (progress - RAIN_EASE_START) / (1 - RAIN_EASE_START)
  const easedLateProgress = lateProgress + lateProgress ** 2 - lateProgress ** 3
  return RAIN_EASE_START + (1 - RAIN_EASE_START) * easedLateProgress
}

// Horizontal placement is cosmetic, but overlap changes readability. Derive it
// from signed card data and the input round instead of Math.random() so replaying
// the same challenge produces the same field on every device.
export function rainLaneLeftPct(cardId: number, inputRound: number): number {
  let value = (cardId ^ Math.imul(inputRound + 1, 0x9e3779b1)) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return 6 + ((value >>> 0) / 0xffffffff) * 72
}

export function rainRecoveryShiftMs(now: number, deadlines: readonly number[], minimumWindowMs: number): number {
  if (deadlines.length === 0) return 0
  const nextImpactAt = Math.min(...deadlines)
  return Math.max(0, now + minimumWindowMs - nextImpactAt)
}
