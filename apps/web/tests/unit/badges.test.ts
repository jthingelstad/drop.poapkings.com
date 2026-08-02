import { describe, expect, it } from 'vitest'
import { badgeViews } from '../../src/lib/badges'

describe('badge milestone progress', () => {
  it('measures count and best badges against the visible next milestone', () => {
    const views = badgeViews([
      {
        slug: 'reps',
        value: 175,
        rungIndex: 0,
        earnedAt: ['2026-07-20T18:00:00.000Z']
      },
      {
        slug: 'marathon',
        value: 7,
        rungIndex: 0,
        earnedAt: ['2026-07-21T18:00:00.000Z']
      }
    ])

    expect(views.find((badge) => badge.slug === 'reps')?.progress).toBe(0.7)
    expect(views.find((badge) => badge.slug === 'marathon')?.progress).toBe(0.7)
  })

  it('keeps descending time progress within the current milestone interval', () => {
    const clockbreaker = badgeViews([
      {
        slug: 'clockbreaker',
        value: 34.2,
        rungIndex: 3,
        earnedAt: ['2026-07-18T18:00:00.000Z'],
        runsAtRung: [12, 9, 5, 2]
      }
    ]).find((badge) => badge.slug === 'clockbreaker')

    expect(clockbreaker?.progress).toBeCloseTo(0.16)
  })
})
