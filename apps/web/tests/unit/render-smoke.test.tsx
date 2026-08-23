import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { accountStatus, player } from '../../src/lib/account'
import { route } from '../../src/lib/router'
import { apiAvailability, transportOffline } from '../../src/lib/api-availability'
import { layout } from '../../src/lib/use-layout'

const CASES = [
  ['/', 'Elixir Drop'],
  ['/practice', 'Practice'],
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
    ['/app-info', 'App info']
  ])('announces %s as its own screen title', async (path, label) => {
    route.value = path
    const html = await renderToStringAsync(<App />)

    expect(html).toContain(`<h1 class="sr-only">${label}</h1>`)
    expect(html).not.toContain('<h1 class="sr-only">Elixir Drop</h1>')
  })

  it('lets the sign-in screen own its visible page heading', async () => {
    route.value = '/login'
    const html = await renderToStringAsync(<App />)

    expect(html).toContain('<h1>Sign In</h1>')
    expect(html).not.toContain('<h1 class="sr-only">Sign in</h1>')
  })

  it('keeps the direct Practice route on mobile', async () => {
    layout.value = 'mobile'
    route.value = '/practice'

    const html = await renderToStringAsync(<App />)

    expect(html).toContain('Practice')
    expect(html).toContain('<h1 class="sr-only">Practice</h1>')
  })

  it('keeps a restricted player in Practice while blocking ranked routes', async () => {
    player.value = { ...player.value!, rankedAccess: 'restricted' }

    route.value = '/surge'
    const rankedHtml = await renderToStringAsync(<App />)
    expect(rankedHtml).toContain('Ranked restricted')
    expect(rankedHtml).toContain('Practice')
    expect(rankedHtml).toContain('Fair Play')

    route.value = '/practice'
    const practiceHtml = await renderToStringAsync(<App />)
    expect(practiceHtml).toContain('Practice')
    expect(practiceHtml).not.toContain('Ranked restricted')
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

  it('fills the desktop shell with persistent nav, wallpaper, and an aside that repeats nothing', async () => {
    route.value = '/'
    const html = await renderToStringAsync(<App />)

    // The margin's job is the wallpaper; the right aside keeps only the live
    // feed. Everything ABOUT the app — nav, the ambient toggle, the meta links
    // — sits at the foot of the LEFT rail. Standings and the season card left.
    expect(html).toContain('ed-wallpaper')
    expect(html).toContain('Desktop navigation')
    expect(html).toContain('Live · recent runs')
    expect(html).toContain('Falling Cards')
    expect(html).toContain('ed-rail-meta')
    expect(html).not.toContain('ed-railfoot')
    expect(html).not.toContain('Season standings')
    expect(html).not.toContain('Speed keys')
  })

  it('mounts ranked games directly on desktop and keeps the wallpaper behind play', async () => {
    route.value = '/surge'
    const rankedHtml = await renderToStringAsync(<App />)
    expect(rankedHtml).toContain('Charging')
    expect(rankedHtml).toContain('ed-desktop--game')
    expect(rankedHtml).toContain('ed-wallpaper')
    expect(rankedHtml).not.toContain('thumb game')
  })
})
