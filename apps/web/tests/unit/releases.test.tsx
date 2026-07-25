import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { renderToStringAsync } from 'preact-render-to-string'

vi.mock('../../src/lib/router', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/router')>()
  return { ...actual, navigate: vi.fn() }
})

import { navigate, route } from '../../src/lib/router'
import { decideReleaseNotice, dismissRelease, initReleaseNotice, pendingRelease } from '../../src/lib/release-notice'
import { latestRelease, releaseDateLabel, releases, type ReleaseEntry } from '../../src/lib/releases'
import ReleaseList from '../../src/components/ReleaseList'
import ReleaseNotice from '../../src/components/ReleaseNotice'
import MetaPage from '../../src/screens/MetaPage'
import MetaMoreList from '../../src/components/MetaMoreList'
import { RELEASES } from '../../src/data/meta-content'

const SEEN_KEY = 'elixirdrop:releaseSeen'

const OLDER: ReleaseEntry = {
  id: 'mighty-musketeer',
  name: 'Mighty Musketeer',
  date: '2026-06-01',
  build: 'abcdef123456',
  headline: 'Mighty Musketeer is live',
  notes: ['The first cut.', 'Two short paragraphs.']
}

const hosts: HTMLElement[] = []

async function mount(vnode: VNode): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  await act(async () => {
    render(vnode, host)
  })
  return host
}

async function press(key: string): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pendingRelease.value = null
  route.value = '/'
})

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host)
    host.remove()
  }
  pendingRelease.value = null
  route.value = '/'
})

// =============================================================================
// The decision
// =============================================================================
describe('decideReleaseNotice', () => {
  it('records a first-time visitor and shows them nothing', () => {
    expect(decideReleaseNotice('radiant-royal-giant', null)).toBe('record')
  })

  it('shows the notice when a newer release than the recorded one shipped', () => {
    expect(decideReleaseNotice('radiant-royal-giant', 'mighty-musketeer')).toBe('show')
  })

  it('stays quiet when the recorded release is the newest (seen, or dismissed)', () => {
    expect(decideReleaseNotice('radiant-royal-giant', 'radiant-royal-giant')).toBe('none')
  })

  it('stays quiet when no release has been cut', () => {
    expect(decideReleaseNotice(null, null)).toBe('none')
    expect(decideReleaseNotice(null, 'mighty-musketeer')).toBe('none')
  })
})

describe('initReleaseNotice', () => {
  it('silently records the current release on a first visit', () => {
    initReleaseNotice()
    expect(pendingRelease.value).toBe(null)
    expect(localStorage.getItem(SEEN_KEY)).toBe(latestRelease?.id)
  })

  it('queues the newest release for a player who last saw an older one', () => {
    localStorage.setItem(SEEN_KEY, OLDER.id)
    initReleaseNotice()
    expect(pendingRelease.value).toBe(latestRelease)
  })

  it('never shows the same release twice once dismissed', () => {
    localStorage.setItem(SEEN_KEY, OLDER.id)
    initReleaseNotice()
    dismissRelease()
    expect(pendingRelease.value).toBe(null)
    expect(localStorage.getItem(SEEN_KEY)).toBe(latestRelease?.id)

    initReleaseNotice()
    expect(pendingRelease.value).toBe(null)
  })

  it('treats a blank stored value as a first visit', () => {
    localStorage.setItem(SEEN_KEY, '   ')
    initReleaseNotice()
    expect(pendingRelease.value).toBe(null)
    expect(localStorage.getItem(SEEN_KEY)).toBe(latestRelease?.id)
  })
})

// =============================================================================
// The overlay
// =============================================================================
describe('ReleaseNotice', () => {
  it('renders nothing with no release queued', async () => {
    const host = await mount(<ReleaseNotice />)
    expect(host.innerHTML).toBe('')
  })

  it('holds the notice during a game and shows it once play is over', async () => {
    pendingRelease.value = OLDER
    route.value = '/surge'
    const host = await mount(<ReleaseNotice />)
    expect(host.querySelector('[data-testid="release-notice"]')).toBe(null)

    await act(async () => {
      route.value = '/'
    })
    expect(host.querySelector('[data-testid="release-notice"]')).not.toBe(null)
    // The release is held, never dropped.
    expect(pendingRelease.value).toBe(OLDER)
  })

  it('is a labelled modal dialog that takes focus and locks the page', async () => {
    pendingRelease.value = OLDER
    const host = await mount(<ReleaseNotice />)
    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector('#release-notice-title')!.textContent).toBe(OLDER.name)
    expect(host.querySelector('#release-notice-lede')!.textContent).toBe(OLDER.headline)
    expect(dialog.getAttribute('aria-labelledby')).toBe('release-notice-title')
    expect(document.body.classList.contains('modal-open')).toBe(true)
    // Focus moves to the dialog itself, so its title and headline are announced
    // before any control.
    expect(document.activeElement).toBe(dialog)
  })

  it('traps Tab inside the dialog in both directions', async () => {
    pendingRelease.value = OLDER
    const host = await mount(<ReleaseNotice />)
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]
    const first = buttons[0]!
    const last = buttons[buttons.length - 1]!

    // From the dialog container, Tab enters at the first control...
    await press('Tab')
    expect(document.activeElement).toBe(first)

    last.focus()
    await press('Tab')
    expect(document.activeElement).toBe(first)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(last)
  })

  it('dismisses on Escape, records the release, and releases the scroll lock', async () => {
    pendingRelease.value = OLDER
    await mount(<ReleaseNotice />)
    await press('Escape')
    expect(pendingRelease.value).toBe(null)
    expect(localStorage.getItem(SEEN_KEY)).toBe(OLDER.id)
    expect(document.body.classList.contains('modal-open')).toBe(false)
  })

  it('dismisses on a backdrop click', async () => {
    pendingRelease.value = OLDER
    const host = await mount(<ReleaseNotice />)
    await click(host.querySelector('[data-testid="release-notice"]')!)
    expect(pendingRelease.value).toBe(null)
  })

  it('sends the player to the full history and does not show again', async () => {
    pendingRelease.value = OLDER
    const host = await mount(<ReleaseNotice />)
    const cta = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('See what'))!
    await click(cta)
    expect(navigate).toHaveBeenCalledWith('/releases')
    expect(pendingRelease.value).toBe(null)
    expect(localStorage.getItem(SEEN_KEY)).toBe(OLDER.id)
  })
})

// =============================================================================
// The page
// =============================================================================
describe('the /releases page', () => {
  it('renders the committed history in the shared meta-page chrome', async () => {
    const html = await renderToStringAsync(<MetaPage kind="releases" />)
    expect(html).toContain('ed-page__back')
    expect(html).toContain(RELEASES.title)
    expect(html).toContain(RELEASES.eyebrow)
    expect(html).toContain('ed-meta-sections')
    const first = releases[0]!
    expect(html).toContain(first.name)
    expect(html).toContain(first.build)
    expect(html).toContain(releaseDateLabel(first.date))
    expect(html).toContain(first.notes[0])
    expect(html).not.toContain(RELEASES.empty)
  })

  it('renders sensibly with no releases cut yet', async () => {
    const html = await renderToStringAsync(<ReleaseList entries={[]} />)
    expect(html).toContain('ed-meta-sections')
    expect(html).toContain(RELEASES.intro)
    expect(html).toContain(RELEASES.empty)
    expect(html).toContain('ed-meta-section--muted')
  })

  it('sits between About and FAQ in Profile’s More list', async () => {
    const html = await renderToStringAsync(<MetaMoreList />)
    expect(html).toContain('Releases')
    expect(html.indexOf('About')).toBeLessThan(html.indexOf('Releases'))
    expect(html.indexOf('Releases')).toBeLessThan(html.indexOf('FAQ'))
  })
})

describe('releaseDateLabel', () => {
  it('formats an ISO date without drifting a day across time zones', () => {
    expect(releaseDateLabel('2026-07-24')).toBe('July 24, 2026')
  })

  it('falls back to the raw value it cannot parse', () => {
    expect(releaseDateLabel('someday')).toBe('someday')
  })
})
