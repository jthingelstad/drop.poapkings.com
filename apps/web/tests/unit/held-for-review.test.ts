import { describe, expect, it } from 'vitest'
import { completedRunSchema } from '../../src/lib/api-contracts'

// The API has always sent `underReview` on a quarantined ranked run, but the
// browser's schema dropped it, so a held player was told "saved" and then
// silently never reached the board. These guard the parse, which is where the
// bug lived — a zod object strips unknown keys without complaining, so nothing
// failed loudly when this was missing.
const recorded = {
  accepted: true as const,
  runId: 'run-1',
  mode: 'surge' as const,
  score: 58_410,
  season: {
    id: '2026-07',
    startsAt: '2026-07-06T10:00:00.000Z',
    endsAt: '2026-08-03T10:00:00.000Z',
    durationWeeks: 4,
    source: 'clash-royale',
    crSeasonId: 134,
    currentWeek: 2,
    daysRemainingInWeek: 2,
    periodType: 'warDay',
    clockUpdatedAt: '2026-07-18T19:00:00.000Z'
  },
  completedAt: '2026-07-25T18:00:00.000Z',
  totalGames: 12,
  xp: 480,
  level: 2,
  levelStartGames: 10,
  nextLevelGames: 25
}

describe('completedRunSchema underReview', () => {
  it('keeps underReview when the run was held', () => {
    const parsed = completedRunSchema.parse({ ...recorded, underReview: true })
    expect(parsed).toMatchObject({ underReview: true })
  })

  it('leaves it undefined on an ordinary recorded run', () => {
    const parsed = completedRunSchema.parse(recorded)
    expect((parsed as { underReview?: boolean }).underReview).toBeUndefined()
  })

  it('never reports a guest completion as held', () => {
    // Guests take the strict scoring path, which throws instead of flagging, so
    // a guest result has no review state to carry.
    const parsed = completedRunSchema.parse({
      accepted: true,
      guest: true,
      mode: 'surge',
      score: 58_410,
      season: recorded.season
    })
    expect((parsed as { underReview?: boolean }).underReview).toBeUndefined()
  })
})
