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

  it('shows clan, account age, and the collection count without the card grid', async () => {
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
    expect(html).toContain('8 years, 10 days in Clash Royale')
    expect(html).toContain('Calculated from the Years Played badge’s day count')
    // Collection COUNT stays; the card GRID is gone (it had no use in Drop).
    expect(html).toContain('1 cards')
    expect(html).toContain('Not used in Drop')
    expect(html).not.toContain('cr-card-grid')
    expect(html).not.toContain('Card collection')
    expect(html).not.toContain('api-assets.clashroyale.com')
    // No CR card-level or CR-trophy data is ever surfaced.
    expect(html).not.toContain('Card level')
  })
})
