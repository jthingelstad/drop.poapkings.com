import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecruiter, recruiterAttribution, recruiterToken, rememberRecruiter } from '../../src/lib/referral'

describe('shared-link recruitment attribution', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores only a normalized public share token', () => {
    rememberRecruiter('ab2cd3', 1_000)

    expect(recruiterToken(2_000)).toBe('AB2CD3')
    expect(localStorage.getItem('elixirdrop:recruiter:v1')).toBe(JSON.stringify({ token: 'AB2CD3', capturedAt: 1_000 }))
  })

  it('drops invalid and expired attribution', () => {
    rememberRecruiter('not-a-token', 1_000)
    expect(recruiterToken(2_000)).toBeUndefined()

    rememberRecruiter('AB2CD3', 1_000)
    expect(recruiterToken(31 * 24 * 60 * 60 * 1_000)).toBeUndefined()
    expect(localStorage.getItem('elixirdrop:recruiter:v1')).toBeNull()
  })

  it('can be consumed after a successful login request', () => {
    rememberRecruiter('AB2CD3')
    clearRecruiter()

    expect(recruiterToken()).toBeUndefined()
  })

  it('reads the player/run attribution captured by a clean share landing', () => {
    const playerId = '11111111-1111-4111-8111-111111111111'
    const runId = '22222222-2222-4222-8222-222222222222'
    localStorage.setItem('elixirdrop:recruiter:v1', JSON.stringify({ playerId, runId, capturedAt: 1_000 }))

    expect(recruiterAttribution(2_000)).toEqual({ playerId, runId })
    expect(recruiterToken(2_000)).toBeUndefined()
  })

  it('reads the player/badge/rung attribution captured by a clean badge landing', () => {
    const playerId = '11111111-1111-4111-8111-111111111111'
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({ playerId, badgeSlug: 'clockbreaker', rungIndex: 3, capturedAt: 1_000 })
    )

    expect(recruiterAttribution(2_000)).toEqual({ playerId, badgeSlug: 'clockbreaker', rungIndex: 3 })
    expect(recruiterToken(2_000)).toBeUndefined()
  })

  it('reads a generic invitation by public Drop player tag without retaining a UUID', () => {
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({ dropPlayerTag: 'P7H47PSTT93', invite: true, capturedAt: 1_000 })
    )

    expect(recruiterAttribution(2_000)).toEqual({ dropPlayerTag: 'P7H47PSTT93', invite: true })
  })
})
