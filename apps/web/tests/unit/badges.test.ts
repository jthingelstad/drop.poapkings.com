import { BADGE_LIST } from '@elixir-drop/contracts'
import { describe, expect, it } from 'vitest'
import { badgeViews } from '../../src/lib/badges'

describe('badge milestone progress', () => {
  it('gives every secret badge an earned-by explanation', () => {
    const secrets = BADGE_LIST.filter((badge) => badge.hidden)

    expect(secrets).toHaveLength(7)
    for (const badge of secrets) expect(badge.requirement).toMatch(/^Earned by .+\.$/)
  })

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

  it('shows First Drop on any earned player profile and omits it for non-earners', () => {
    expect(badgeViews([]).find((badge) => badge.slug === 'first-drop')).toBeUndefined()

    const earned = badgeViews([
      {
        slug: 'first-drop',
        value: 100,
        rungIndex: 0,
        earnedAt: ['2026-08-25T12:00:00.000Z']
      }
    ]).find((badge) => badge.slug === 'first-drop')

    expect(earned).toMatchObject({
      name: 'First Drop',
      earned: true,
      chip: '100'
    })
  })
})
