import { describe, expect, it } from 'vitest'
import { badgeSharePayload, type BadgeShareInput } from '../../src/lib/share-badge'

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
    const payload = badgeSharePayload(badge, 'https://drop.poapkings.com/?source=test#/profile')

    expect(payload.title).toBe('Knight Main earned Clockbreaker | Elixir Drop')
    expect(payload.text).toBe('Knight Main earned the Clockbreaker badge on Elixir Drop — 35s.')
    expect(payload.url).toBe('https://drop.poapkings.com/#/players/player%2Fone')
    expect(payload.copyText).toBe(`${payload.text}\n${payload.url}`)
  })
})
