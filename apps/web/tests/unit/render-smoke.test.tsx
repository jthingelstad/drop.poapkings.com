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

// Ranked play is now touch-gated (lib/use-layout supportsTouchPlay). The SSR
// smoke renders the ranked game routes, so the default environment is a
// touch-capable device; the dedicated gate test below drops touch to assert the
// mouse-only fallback.
function setTouchPlay(supported: boolean) {
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: supported ? 1 : 0, configurable: true })
}

describe('SSR render smoke', () => {
  beforeEach(() => {
    setTouchPlay(true)
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

  it('fills the desktop margin with wallpaper and an aside that repeats nothing', async () => {
    route.value = '/'
    const html = await renderToStringAsync(<App />)

    // The margin's job is the wallpaper; the aside keeps only the live feed and
    // the launcher. Standings, the season card and the meta cluster left — the
    // meta links live in You · Account, which was the point of gathering them.
    expect(html).toContain('ed-wallpaper')
    expect(html).toContain('Live · recent runs')
    expect(html).toContain('Falling Cards')
    expect(html).not.toContain('ed-railfoot')
    expect(html).not.toContain('Season standings')
  })

  // Ranked runs are timed to the millisecond and fair only on touch. A mouse-only
  // device (no coarse pointer, no touch points) is held to Practice; Practice and
  // the Ladder stay open. This is input-based, not width-based — the letterbox
  // layout is still desktop here.
  it('gates the ranked modes to touch and keeps Practice open on a mouse-only device', async () => {
    setTouchPlay(false)

    route.value = '/surge'
    const rankedHtml = await renderToStringAsync(<App />)
    // The gate names the mode it stopped, says why once, and offers two ways
    // out that are not the phone.
    expect(rankedHtml).toContain('Surge is a thumb game')
    expect(rankedHtml).toContain('Scan to open Surge on your phone.')
    expect(rankedHtml).toContain('Practice instead')
    expect(rankedHtml).toContain('Open the Surge board')
    expect(rankedHtml).not.toContain('Charging')
    // Nothing ambient behind a screen that is asking for a decision.
    expect(rankedHtml).not.toContain('ed-wallpaper')

    route.value = '/rain'
    const rainHtml = await renderToStringAsync(<App />)
    // The gate is per mode, so a player who came for Rain is not told about Surge.
    expect(rainHtml).toContain('Rain is a thumb game')

    route.value = '/practice'
    const practiceHtml = await renderToStringAsync(<App />)
    expect(practiceHtml).toContain('Practice')
    expect(practiceHtml).not.toContain('is a thumb game')

    route.value = '/leaderboards'
    const ladderHtml = await renderToStringAsync(<App />)
    expect(ladderHtml).not.toContain('is a thumb game')
  })
})
