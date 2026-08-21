import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecruiter, recruiterToken, rememberRecruiter } from '../../src/lib/referral'

describe('shared-run recruitment attribution', () => {
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
})
