import { describe, expect, it } from 'vitest'
import { isPlayerTagNudgeDue, PLAYER_TAG_NUDGE_INTERVAL_MS } from '../../src/lib/player-tag-nudge'

describe('weekly player-tag reminder', () => {
  const now = Date.UTC(2026, 7, 7, 12)

  it('is due for a player who has never seen it', () => {
    expect(isPlayerTagNudgeDue(undefined, now)).toBe(true)
  })

  it('stays quiet until a full seven days have elapsed', () => {
    expect(isPlayerTagNudgeDue(now - PLAYER_TAG_NUDGE_INTERVAL_MS + 1, now)).toBe(false)
    expect(isPlayerTagNudgeDue(now - PLAYER_TAG_NUDGE_INTERVAL_MS, now)).toBe(true)
  })
})
