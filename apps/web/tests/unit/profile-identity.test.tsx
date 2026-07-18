import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'preact'
import { renderToStringAsync } from 'preact-render-to-string'
import { accountStatus, player } from '../../src/lib/account'
import Profile from '../../src/screens/Profile'

const basePlayer = {
  id: 'player-1',
  email: 'player@example.com',
  totalGames: 12,
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

describe('favorite-card identity', () => {
  it('shows the saved card as the player profile image', async () => {
    accountStatus.value = 'authenticated'
    player.value = {
      ...basePlayer,
      publicName: 'Knight Main',
      favoriteCardId: 26000000
    }

    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('Knight Main')
    expect(html).toContain('Knight · Favorite card')
    expect(html).toContain('Knight favorite card')
    expect(html).toContain('Change card and name')
  })

  it('prompts a legacy profile to choose from the canonical cards', async () => {
    accountStatus.value = 'authenticated'
    player.value = basePlayer

    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('Choose a favorite card')
    expect(html).toContain('Search all cards')
    expect(html).toContain('aria-label="Choose your favorite card"')
    expect(html).toContain('Knight')
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

    expect(container.textContent).toContain('Knight · Favorite card')
    expect(container.querySelector('input[placeholder="#PLAYER_TAG"]')).toHaveProperty('value', '#2PYQ0')
    expect(container.querySelector('input[placeholder="Search all cards"]')).toBeNull()
    expect(container.textContent).toContain('Change card and name')

    render(<></>, container)
  })

  it('shows clan, account age, and cards without card levels', async () => {
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
          badgeId: 16000000,
          role: 'coLeader'
        },
        accountAge: { days: 2_930, years: 8 },
        cards: [
          {
            id: 26000000,
            name: 'Knight',
            iconUrl: 'https://api-assets.clashroyale.com/cards/300/knight.png'
          }
        ],
        fetchedAt: '2026-07-18T12:00:00.000Z'
      }
    }

    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('CR Player')
    expect(html).toContain('POAP KINGS')
    expect(html).toContain('Co Leader')
    expect(html).toContain('About 8 years in Clash Royale')
    expect(html).toContain('Knight')
    expect(html).toContain('Levels stay private')
    expect(html).not.toContain('Card level')
    expect(html).not.toContain('troph')
    expect(html).not.toContain('arena')
  })
})
