import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ createInviteShareToken: vi.fn() }))
vi.mock('../../src/lib/api', () => ({ createInviteShareToken: api.createInviteShareToken }))
vi.mock('../../src/lib/account', () => ({ sessionToken: () => 'test-session' }))

import { badgeSharePayload, shareBadge, type BadgeShareInput } from '../../src/lib/share-badge'

const badge: BadgeShareInput = {
  slug: 'clockbreaker',
  name: 'Clockbreaker',
  chip: '35s',
  tier: 'silver',
  requirement: 'Fastest Surge run',
  playerId: 'player/one',
  playerName: 'Knight Main'
}

describe('badge sharing', () => {
  it('identifies the player and earned rung and links to the public badge wall', () => {
    const payload = badgeSharePayload(badge, 'https://drop.poapkings.com/#/s/AB2CD3')

    expect(payload.title).toBe('Knight Main earned Clockbreaker | Elixir Drop')
    expect(payload.text).toBe('Knight Main earned the Clockbreaker badge on Elixir Drop — 35s.')
    expect(payload.url).toBe('https://drop.poapkings.com/#/s/AB2CD3')
    expect(payload.copyText).toBe(`${payload.text}\n${payload.url}`)
  })

  it('mints a Recruiter invitation before opening the share sheet', async () => {
    api.createInviteShareToken.mockResolvedValue({ token: 'AB2CD3' })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    await expect(shareBadge(badge, 'https://drop.poapkings.com/#/profile')).resolves.toBe('shared')

    expect(api.createInviteShareToken).toHaveBeenCalledWith('player', 'test-session', 'player/one')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://drop.poapkings.com/#/s/AB2CD3' }))
  })
})

afterEach(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  vi.clearAllMocks()
})
