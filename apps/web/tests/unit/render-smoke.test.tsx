import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { accountStatus, player } from '../../src/lib/account'
import { route } from '../../src/lib/router'

const CASES = [
  ['/', 'Elixir Drop'],
  ['/practice', 'PREPARING'],
  ['/surge', 'PREPARING'],
  ['/higher-lower', 'PREPARING'],
  ['/trade', 'PREPARING'],
  ['/survival', 'PREPARING'],
  ['/rain', 'PREPARING'],
  ['/settings', 'Settings'],
  ['/about', 'About Elixir Drop'],
  ['/faq', 'Frequently asked'],
  ['/install', 'Install Elixir Drop']
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
      xp: 60,
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
    // The shell wraps every route — check the desktop shell wrapper here.
    expect(html).toContain('ed-app')
  })

  // Regression: a routed path with no ROUTE_LABELS entry silently announces the
  // generic "Elixir Drop" as its screen heading. /rain shipped that way — one of
  // six modes with no name in the accessibility tree.
  it.each([
    ['/practice', 'Practice'],
    ['/surge', 'Surge'],
    ['/higher-lower', 'Higher / Lower'],
    ['/trade', 'Trade'],
    ['/survival', 'Survival'],
    ['/rain', 'Rain'],
    ['/leaderboards', 'Leaderboards'],
    ['/settings', 'Settings'],
    ['/privacy', 'Privacy'],
    ['/about', 'About'],
    ['/faq', 'FAQ'],
    ['/install', 'Install'],
    ['/login', 'Sign in']
  ])('announces %s as its own screen title', async (path, label) => {
    route.value = path
    const html = await renderToStringAsync(<App />)

    expect(html).toContain(`<h1 class="sr-only">${label}</h1>`)
    expect(html).not.toContain('<h1 class="sr-only">Elixir Drop</h1>')
  })

  it('renders build metadata on settings', async () => {
    route.value = '/settings'
    const html = await renderToStringAsync(<App />)

    expect(html).toContain('Build ID')
    expect(html).toContain('Build date')
  })

  it('links to the Elixir Drop Discord from the desktop rail cluster', async () => {
    route.value = '/'
    const html = await renderToStringAsync(<App />)

    // The old global footer moved into the meta entry points; the desktop
    // left-rail cluster carries the external Discord link.
    expect(html).toContain('ed-railfoot')
    expect(html).toContain('https://discord.gg/SdvKfJW5kA')
  })
})
