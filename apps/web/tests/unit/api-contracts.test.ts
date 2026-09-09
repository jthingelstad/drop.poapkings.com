import { describe, expect, it } from 'vitest'
import {
  activityResponseSchema,
  leaderboardResponseSchema,
  seasonHistoryResponseSchema,
  seasonSchema,
  updatesResponseSchema
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

describe('player Updates contract', () => {
  it('accepts the three public entry kinds', () => {
    const entries = [
      {
        id: 'higher-lower-arrives',
        kind: 'feature',
        impact: 'gameplay',
        publishedAt: '2026-09-08T16:00:00.000Z',
        title: 'Higher or Lower enters the arena',
        body: 'Choose the card with the higher Elixir cost.'
      },
      {
        id: 'season-136-results',
        kind: 'season',
        publishedAt: '2026-10-05T10:00:00.000Z',
        title: 'Season 136 results',
        body: 'The latest champions are crowned.'
      },
      {
        id: 'maintenance-complete',
        kind: 'message',
        publishedAt: '2026-10-06T10:00:00.000Z',
        title: 'Back in the arena',
        body: 'Player services are available again.'
      }
    ]

    expect(updatesResponseSchema.parse({ entries }).entries).toHaveLength(3)
  })

  it('rejects a feature without its player-impact category', () => {
    expect(() =>
      updatesResponseSchema.parse({
        entries: [
          {
            id: 'missing-impact',
            kind: 'feature',
            publishedAt: '2026-09-08T16:00:00.000Z',
            title: 'Missing impact',
            body: 'This feature has no category.'
          }
        ]
      })
    ).toThrow()
  })
})
