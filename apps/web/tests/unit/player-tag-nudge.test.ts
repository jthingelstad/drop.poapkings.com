import { afterEach, describe, expect, it } from 'vitest'
import {
  deferPlayerTagNudge,
  dismissPlayerTagNudge,
  isPlayerTagNudgeDue,
  openPlayerTagNudgeIfDue,
  PLAYER_TAG_NUDGE_INTERVAL_MS,
  playerTagNudgePlayerId
} from '../../src/lib/player-tag-nudge'

describe('weekly player-tag reminder', () => {
  const now = Date.UTC(2026, 7, 7, 12)

  afterEach(() => dismissPlayerTagNudge())

  it('is due for a player who has never seen it', () => {
    expect(isPlayerTagNudgeDue(undefined, now)).toBe(true)
  })

  it('stays quiet until a full seven days have elapsed', () => {
    expect(isPlayerTagNudgeDue(now - PLAYER_TAG_NUDGE_INTERVAL_MS + 1, now)).toBe(false)
    expect(isPlayerTagNudgeDue(now - PLAYER_TAG_NUDGE_INTERVAL_MS, now)).toBe(true)
  })

  it('waits seven days after first-time player setup', () => {
    deferPlayerTagNudge('new-player', now)

    openPlayerTagNudgeIfDue('new-player', now + PLAYER_TAG_NUDGE_INTERVAL_MS - 1)
    expect(playerTagNudgePlayerId.value).toBeNull()

    openPlayerTagNudgeIfDue('new-player', now + PLAYER_TAG_NUDGE_INTERVAL_MS)
    expect(playerTagNudgePlayerId.value).toBe('new-player')
  })
})
