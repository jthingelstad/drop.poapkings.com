import { describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import App from '../../src/App'
import { route } from '../../src/lib/router'

const CASES = [
  ['/', 'Elixir Drop'],
  ['/practice', 'How much elixir does this cost?'],
  ['/identify', 'Name the card.'],
  ['/surge', '15 cards. One honest time.'],
  ['/higher-lower', 'Higher'],
  ['/trade', 'Read the elixir trade.'],
  ['/blitz', 'Blitz'],
  ['/survival', 'Survival'],
  ['/ladder', 'Sort five cards by elixir.'],
  ['/endless-ladder', 'Grow the ladder one card at a time.'],
  ['/cost-sweep', 'Tap every card with the target cost.'],
  ['/settings', 'Settings']
] as const

describe('SSR render smoke', () => {
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
