import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { accountStatus, player } from '../../src/lib/account'
import { route } from '../../src/lib/router'

const CASES = [
  ['/', 'Elixir Drop'],
  ['/practice', 'Preparing your game…'],
  ['/surge', 'Preparing your game…'],
  ['/higher-lower', 'Preparing your game…'],
  ['/trade', 'Preparing your game…'],
  ['/survival', 'Preparing your game…'],
  ['/settings', 'Settings']
] as const

describe('SSR render smoke', () => {
  beforeEach(() => {
    accountStatus.value = 'authenticated'
    player.value = {
      id: 'player-1',
      email: 'player@example.com',
      publicName: 'Knight Main',
      favoriteCardId: 26000000,
      totalGames: 1,
      level: 1,
      levelStartGames: 0,
      nextLevelGames: 10,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z'
    }
  })

  it.each(CASES)('renders %s', async (path, expectedText) => {
    route.value = path
    const html = await renderToStringAsync(<App />)

    expect(html).toContain(expectedText)
    expect(html).toContain('site-foot')
  })

  it('renders build metadata on settings', async () => {
    route.value = '/settings'
    const html = await renderToStringAsync(<App />)

    expect(html).toContain('Build ID')
    expect(html).toContain('Build date')
  })

  it('links to the Elixir Drop Discord from the footer', async () => {
    route.value = '/'
    const html = await renderToStringAsync(<App />)

    expect(html).toContain('Join the Elixir Drop Discord')
    expect(html).toContain('https://discord.gg/SdvKfJW5kA')
  })
})
