import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { accountStatus, player } from '../../src/lib/account'
import { route } from '../../src/lib/router'
import { offline } from '../../src/lib/api-availability'

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
  ['/fair-play', 'Fair Play'],
  ['/faq', 'Frequently asked'],
  ['/install', 'Install Elixir Drop'],
  ['/app-info', 'App Info']
] as const

describe('SSR render smoke', () => {
  beforeEach(() => {
    offline.value = false
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
    ['/fair-play', 'Fair Play'],
    ['/faq', 'FAQ'],
    ['/install', 'Install'],
    ['/app-info', 'App info'],
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

  it('keeps a restricted player in Practice while blocking ranked routes', async () => {
    player.value = { ...player.value!, rankedAccess: 'restricted' }

    route.value = '/surge'
    const rankedHtml = await renderToStringAsync(<App />)
    expect(rankedHtml).toContain('Ranked access restricted')
    expect(rankedHtml).toContain('Practice')
    expect(rankedHtml).toContain('Fair Play')
    expect(rankedHtml).toContain('mailto:drop@poapkings.com?subject=Elixir%20Drop%20ranked-access%20re-review')

    route.value = '/practice'
    const practiceHtml = await renderToStringAsync(<App />)
    expect(practiceHtml).toContain('PREPARING')
    expect(practiceHtml).not.toContain('Ranked access restricted')
  })

  it.each([
    ['/leaderboards', 'Leaderboards need a connection'],
    ['/profile', 'Your player data is safe']
  ])('gives %s a route-specific offline treatment', async (path, heading) => {
    offline.value = true
    accountStatus.value = 'unavailable'
    player.value = null
    route.value = path

    const html = await renderToStringAsync(<App />)

    expect(html).toContain('ed-offline-page')
    expect(html).toContain(heading)
    expect(html).toContain('Practice is still ready')
    expect(html).toContain('Open Practice')
    expect(html).toContain('Back to games')
    expect(html).not.toContain('Player services are reconnecting')
    expect(html).not.toContain('Loading leaderboard')
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
