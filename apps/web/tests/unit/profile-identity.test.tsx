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
    expect(html).toContain('Knight · Player Card')
    expect(html).toContain('Knight favorite card')
    // The profile view offers an Edit action into the identity editor.
    expect(html).toContain('ed-profile__edit')
  })

  it('prompts a legacy profile to choose from the canonical cards', async () => {
    accountStatus.value = 'authenticated'
    player.value = basePlayer

    // No favorite card yet → the editor opens straight to setup.
    const html = await renderToStringAsync(<Profile />)

    expect(html).toContain('Finish setup')
    expect(html).toContain('Search cards')
    expect(html).toContain('aria-label="Choose your favorite card"')
    expect(html).toContain('Knight')
    expect(html.indexOf('1. Choose your Player Card')).toBeLessThan(html.indexOf('2. Choose your player name'))
    expect(html).toContain('Choose a Player Card first')
    expect(html).not.toContain('aria-label="Clash Royale player tag"')
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

    // Sync ran → the player has a favorite card, so the view (not the editor) shows.
    expect(container.textContent).toContain('Knight · Player Card')
    expect(container.querySelector('input[placeholder="Search cards"]')).toBeNull()
    expect(container.querySelector('.ed-profile__edit')).not.toBeNull()

    render(<></>, container)
  })

  it('collapses the Clash Royale profile to one row: clan, role, tag, age', async () => {
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

    expect(html).toContain('POAP KINGS')
    expect(html).toContain('Co Leader')
    expect(html).toContain('#2PYQ0')
    expect(html).toContain('8y 10d playing')
    // The three fact cells and the Collection tile are gone with the row.
    expect(html).not.toContain('Calculated from the Years Played badge’s day count')
    expect(html).not.toContain('Collection')
    expect(html).not.toContain('1 cards')
    expect(html).not.toContain('cr-profile__facts')
    expect(html).not.toContain('cr-card-grid')
    expect(html).not.toContain('Card collection')
    expect(html).not.toContain('api-assets.clashroyale.com')
    // No CR card-level or CR-trophy data is ever surfaced.
    expect(html).not.toContain('Card level')
  })
})
