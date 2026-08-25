import { describe, expect, it } from 'vitest'
import {
  activityResponseSchema,
  leaderboardResponseSchema,
  seasonHistoryResponseSchema,
  seasonSchema
} from '../../src/lib/api-contracts'

const season = {
  id: 135,
  startsAt: '2026-08-03T09:34:00.000Z',
  endsAt: '2026-09-07T10:00:00.000Z',
  durationWeeks: 5
}

describe('numeric season contracts', () => {
  it('normalizes numeric and retired calendar identifiers to Clash season numbers', () => {
    expect(seasonSchema.parse(season).id).toBe(135)
    expect(seasonSchema.parse({ ...season, id: '2026-08' }).id).toBe(135)
    expect(
      leaderboardResponseSchema.parse({
        mode: 'surge',
        scope: 'season',
        seasonId: 135,
        currentSeason: season,
        seasons: [{ id: 135 }],
        entries: []
      })
    ).toMatchObject({ seasonId: 135, seasons: [{ id: 135 }] })
    expect(
      seasonHistoryResponseSchema.parse({
        index: [{ id: 135, games: 1 }],
        seasons: [{ id: 135, games: 1, runs: [] }]
      })
    ).toMatchObject({ index: [{ id: 135 }], seasons: [{ id: 135 }] })
    expect(activityResponseSchema.parse({ seasonId: 135, windowHours: 24, entries: [] }).seasonId).toBe(135)
  })
})
