import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'preact'
import { renderToStringAsync } from 'preact-render-to-string'
import { accountStatus, player } from '../../src/lib/account'
import Profile from '../../src/screens/Profile'

const basePlayer = {
  id: 'player-1',
  email: 'player@example.com',
  totalGames: 12,
  xp: 480,
  level: 2,
  levelStartGames: 10,
  nextLevelGames: 25,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z'
}

afterEach(() => {
  player.value = null
  accountStatus.value = 'anonymous'
})

describe('identity from Elixir', () => {
  it('shows the Elixir name and picture', async () => {
    accountStatus.value = 'authenticated'
    player.value = {
      ...basePlayer,
      publicName: 'Knight Main',
      favoriteCardId: 26000000,
      accountTags: ['developer']
    }

    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('Knight Main')
    expect(html).not.toContain('Player Card')
    expect(html).toContain('Knight profile picture')
    expect(html).toContain('Elixir Drop developer')
    expect(html).toContain('DEV')
    // Edit leaves for Elixir: Drop has no identity editor (2026-11-14).
    expect(html).toContain('Edit on Elixir')
  })

  it('has no setup for a profile without a name or picture', async () => {
    accountStatus.value = 'authenticated'
    player.value = basePlayer

    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('Elixir Player')
    expect(html).not.toContain('Step 1 of 3')
    expect(html).not.toContain('Search cards')
    expect(html).not.toContain('name-option')
  })

  it('syncs a returning player that arrives after the profile mounts', async () => {
    const container = document.createElement('div')
    accountStatus.value = 'loading'
    player.value = null
    render(<Profile />, container)

    player.value = {
      ...basePlayer,
      publicName: 'Knight Main',
      favoriteCardId: 26000000,
      playerTag: '#2PYQ0'
    }
    accountStatus.value = 'authenticated'
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.textContent).toContain('Knight Main')
    expect(container.querySelector('input[placeholder="Search cards"]')).toBeNull()
    expect(container.querySelector('.ed-profile__edit')).not.toBeNull()

    render(<></>, container)
  })

  it('shows the Clash Royale clan name, tag, and age in the Account scope — never the role', async () => {
    accountStatus.value = 'authenticated'
    player.value = {
      ...basePlayer,
      publicName: 'Knight Main',
      favoriteCardId: 26000000,
      playerTag: '#2PYQ0',
      clashRoyale: {
        tag: '#2PYQ0',
        status: 'ready',
        name: 'CR Player',
        clan: {
          tag: '#P0QY',
          name: 'POAP KINGS',
          role: 'coLeader'
        },
        // The card collection is no longer collected, stored, or sent:
        // the profile shape simply has nowhere to put one now.
        fetchedAt: '2026-07-18T12:00:00.000Z'
      }
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    render(<Profile />, container)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Clash Royale lives in the Account scope now.
    const accountTab = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Account'))!
    accountTab.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const text = container.textContent ?? ''

    expect(text).toContain('POAP KINGS')
    expect(text).toContain('#2PYQ0')
    // Years Played went with the profile read (2026-11-13).
    expect(text).not.toMatch(/\d+d playing/)
    // The clan role is deliberately not projected.
    expect(text).not.toContain('Co Leader')
    expect(text).not.toContain('coLeader')
    // No CR card-level, collection, or trophy data is ever surfaced.
    expect(container.innerHTML).not.toContain('api-assets.clashroyale.com')
    expect(text).not.toContain('Card level')
    expect(text).not.toContain('Card collection')

    render(<></>, container)
    container.remove()
  })
})
