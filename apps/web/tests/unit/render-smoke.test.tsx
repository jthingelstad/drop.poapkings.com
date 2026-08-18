import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { accountStatus, player } from '../../src/lib/account'
import { route } from '../../src/lib/router'
import { apiAvailability, transportOffline } from '../../src/lib/api-availability'
import { layout } from '../../src/lib/use-layout'

const CASES = [
  ['/', 'Elixir Drop'],
  ['/practice', 'Training grounds'],
  ['/surge', 'Charging'],
  ['/higher-lower', 'Charging'],
  ['/trade', 'Charging'],
  ['/survival', 'Charging'],
  ['/rain', 'Charging'],
  ['/offline', 'Elixir Drop'],
  ['/settings', 'Settings'],
  ['/app-info', 'App Info']
] as const

describe('SSR render smoke', () => {
  beforeEach(() => {
    apiAvailability.value = 'available'
    transportOffline.value = false
    layout.value = 'desktop'
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
    ['/offline', 'Offline'],
    ['/leaderboards', 'Ladder'],
    ['/settings', 'You'],
    ['/app-info', 'App info'],
    ['/login', 'Sign in']
  ])('announces %s as its own screen title', async (path, label) => {
    route.value = path
    const html = await renderToStringAsync(<App />)

    expect(html).toContain(`<h1 class="sr-only">${label}</h1>`)
    expect(html).not.toContain('<h1 class="sr-only">Elixir Drop</h1>')
  })

  it('folds the legacy Practice hub route into Games on mobile', async () => {
    layout.value = 'mobile'
    route.value = '/practice'

    const html = await renderToStringAsync(<App />)

    expect(html).toContain('Practice')
    expect(html).toContain('Cost Recall')
    expect(html).toContain('Ledger')
    expect(html).not.toContain('practice-hub main-content')
    expect(html).not.toContain('<h1 class="sr-only">Practice</h1>')
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
    expect(practiceHtml).toContain('Training grounds')
    expect(practiceHtml).not.toContain('Ranked access restricted')
  })

  // The redesign names the cause, not the consequence: offline, the Ladder and
  // You stay live (no bundled Offline takeover) and a header chip names why the
  // server data is quiet.
  it.each(['/leaderboards', '/profile'])('keeps %s live and names the cause when offline', async (path) => {
    apiAvailability.value = 'unavailable'
    accountStatus.value = 'authenticated'
    route.value = path

    const html = await renderToStringAsync(<App />)

    expect(html).not.toContain('ed-offline-page')
    expect(html).toContain('OFFLINE')
  })

  it('links to the Elixir Drop Discord guide from the desktop rail cluster', async () => {
    route.value = '/'
    const html = await renderToStringAsync(<App />)

    // The old global footer moved into the meta entry points; the desktop
    // left-rail cluster carries the standalone Discord guide.
    expect(html).toContain('ed-railfoot')
    expect(html).toContain('href="/discord/"')
  })
})
