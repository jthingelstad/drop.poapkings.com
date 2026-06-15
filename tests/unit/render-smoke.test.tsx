import { describe, expect, it } from 'vitest'
import renderToString from 'preact-render-to-string'
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
  ['/settings', 'Settings']
] as const

describe('SSR render smoke', () => {
  it.each(CASES)('renders %s', (path, expectedText) => {
    route.value = path
    const html = renderToString(<App />)

    expect(html).toContain(expectedText)
    expect(html).toContain('site-foot')
  })

  it('renders build metadata on settings', () => {
    route.value = '/settings'
    const html = renderToString(<App />)

    expect(html).toContain('Build ID')
    expect(html).toContain('Build date')
  })
})
