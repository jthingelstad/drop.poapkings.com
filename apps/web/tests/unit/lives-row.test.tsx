// Guards the shared lives row (components/LivesRow.tsx).
//
// The point of this file is the SPENT/LEFT distinction. Counting `.icon`
// elements passes just as happily when every heart renders identically, which
// is exactly the bug this component was written to fix — a row where the
// player cannot tell at a glance how many lives are left. So these assertions
// are on the per-heart modifier class, and they fail if the distinction is
// dropped or inverted.

import { render } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import LivesRow from '../../src/components/LivesRow'

let host: HTMLDivElement | null = null

function mount(lives: number, max = 3) {
  host?.remove()
  host = document.createElement('div')
  document.body.appendChild(host)
  render(<LivesRow lives={lives} max={max} testId="test-lives" />, host)
  return host
}

// Reading the classes rather than the count is what makes this a real guard.
function shape(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('[data-testid="test-lives"] .icon'))
    .map((heart) => (heart.classList.contains('ed-lives__heart--spent') ? '.' : '#'))
    .join('')
}

afterEach(() => {
  host?.remove()
  host = null
})

describe('LivesRow', () => {
  it('fills a heart per life left and empties the rest, in order', () => {
    expect(shape(mount(3))).toBe('###')
    expect(shape(mount(2))).toBe('##.')
    expect(shape(mount(1))).toBe('#..')
    expect(shape(mount(0))).toBe('...')
  })

  it('always renders one heart per life the mode grants', () => {
    expect(mount(3).querySelectorAll('.icon')).toHaveLength(3)
    expect(mount(2, 5).querySelectorAll('.icon')).toHaveLength(5)
    expect(shape(mount(2, 5))).toBe('##...')
  })

  it('carries the count as the row label, since the glyphs are decorative', () => {
    const row = mount(2).querySelector('[data-testid="test-lives"]')
    expect(row?.getAttribute('aria-label')).toBe('2 of 3 lives left')
    expect(row?.getAttribute('role')).toBe('img')
    // The icons must not each announce themselves over the row's own label.
    expect(mount(2).querySelectorAll('.icon[aria-hidden="true"]')).toHaveLength(3)
  })

  it('never renders a negative or overflowing row when a mode over-reports', () => {
    // Rain and Higher/Lower both drive this from a signal that can dip below
    // zero for a frame on the fatal hit.
    expect(shape(mount(-1))).toBe('...')
    expect(shape(mount(9))).toBe('###')
  })
})
