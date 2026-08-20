import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'

const api = vi.hoisted(() => ({
  getSharedRun: vi.fn(),
  createShareToken: vi.fn()
}))

vi.mock('../../src/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/api')>()
  return { ...actual, getSharedRun: api.getSharedRun, createShareToken: api.createShareToken }
})

const shareCard = vi.hoisted(() => ({ renderShareCard: vi.fn(), canShareImage: vi.fn() }))
vi.mock('../../src/lib/share-card', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/share-card')>()
  return { ...actual, renderShareCard: shareCard.renderShareCard, canShareImage: shareCard.canShareImage }
})

vi.mock('../../src/lib/account', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/account')>()
  return { ...actual, sessionToken: () => 'test-session' }
})

import ShareLine from '../../src/components/ShareLine'
import SharedRun, { sharedRunToken } from '../../src/screens/SharedRun'

const flush = () => act(async () => await Promise.resolve())

const sharedPayload = {
  token: 'AB2CD3',
  mode: 'surge' as const,
  score: 17_412,
  seasonId: '2026-08',
  completedAt: '2026-08-19T12:00:20.000Z',
  series: [1200, 900, 1500],
  player: {
    id: 'shared-player',
    publicName: 'Drop King',
    favoriteCardId: 26000000,
    totalGames: 40,
    xp: 900,
    level: 4
  }
}

// The share function itself: mint, then hand the OS sheet an image and the link
// that makes the share countable.
describe('sharing a run', () => {
  let host: HTMLDivElement

  function setNavigator(key: 'share' | 'canShare', value: unknown) {
    Object.defineProperty(navigator, key, { value, configurable: true })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    shareCard.renderShareCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    shareCard.canShareImage.mockReturnValue(true)
    api.createShareToken.mockResolvedValue({ token: 'AB2CD3' })
  })

  afterEach(() => {
    render(null, host)
    host.remove()
    setNavigator('share', undefined)
    setNavigator('canShare', undefined)
  })

  async function tapShare() {
    await act(async () => {
      render(<ShareLine mode="surge" score="17.412s" runId="run-1" card={{ series: [1200, 900] }} />, host)
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.shareline__btn')!.click()
    })
    await flush()
    await flush()
  }

  it('hands the sheet the image and the minted permalink together', async () => {
    const shared: ShareData[] = []
    setNavigator('canShare', () => true)
    setNavigator('share', async (payload: ShareData) => void shared.push(payload))

    await tapShare()

    // The run's own shape rides along on the token, so the permalink can draw it.
    expect(api.createShareToken).toHaveBeenCalledWith('run-1', 'test-session', [1200, 900])
    expect(shared).toHaveLength(1)
    expect(shared[0]!.url).toBe(`${window.location.origin}/#/r/AB2CD3`)
    expect(shared[0]!.files).toHaveLength(1)
    expect(host.textContent).toContain('Shared')
  })

  it('unbundles into copy-the-link and save-the-image with no native sheet', async () => {
    setNavigator('share', undefined)
    setNavigator('canShare', undefined)

    await tapShare()

    // Not a degraded dialog: the same two things the sheet offers, spelled out.
    const unbundled = host.querySelector('.shareline__unbundled')!
    expect(unbundled).toBeTruthy()
    expect(unbundled.querySelector('.shareline__url')?.textContent).toBe(`${window.location.origin}/#/r/AB2CD3`)
    expect(unbundled.querySelector('.shareline__save')?.getAttribute('download')).toBe('elixir-drop.png')
  })

  it('says so rather than sharing a link to nowhere when minting fails', async () => {
    api.createShareToken.mockRejectedValue(new Error('offline'))
    const shared: ShareData[] = []
    setNavigator('canShare', () => true)
    setNavigator('share', async (payload: ShareData) => void shared.push(payload))

    await tapShare()

    expect(shared).toHaveLength(0)
    expect(host.textContent).toContain('Sharing is unavailable right now.')
  })
})

// A shared run opens the RUN, never the home page. This is the same correction
// the public profile needed, so the two match.
describe('the shared-run permalink', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    window.location.hash = ''
  })

  afterEach(() => {
    render(null, host)
    host.remove()
  })

  it('accepts only a well-formed token, in the alphabet the API mints from', () => {
    expect(sharedRunToken('/r/AB2CD3')).toBe('AB2CD3')
    // Case-insensitive on the way in: a link may be retyped or lower-cased by a
    // chat client, and the token itself is upper-case.
    expect(sharedRunToken('/r/ab2cd3')).toBe('AB2CD3')
    // No look-alike glyphs, so a mistyped O or l is not silently accepted.
    expect(sharedRunToken('/r/AB0CD3')).toBeUndefined()
    expect(sharedRunToken('/r/ABCD')).toBeUndefined()
    expect(sharedRunToken('/r/')).toBeUndefined()
  })

  it('shows the run, the score as the button, and the player behind it', async () => {
    api.getSharedRun.mockResolvedValue(sharedPayload)

    await act(async () => {
      render(<SharedRun token="AB2CD3" />, host)
    })
    await flush()

    expect(host.querySelector('.ed-sharedrun__score')?.textContent).toBe('17.412s')
    expect(host.textContent).toContain('BEAT 17.412s')
    expect(host.querySelector('.ed-sharedrun__player-name')?.textContent).toBe('Drop King')
    // The run's own shape travels; the game's half of the chart does not.
    expect(host.querySelectorAll('.ed-sharedrun__bar')).toHaveLength(3)
    expect(host.textContent).toContain('no account needed')

    host.querySelector<HTMLButtonElement>('.ed-sharedrun__cta')!.click()
    expect(window.location.hash).toBe('#/surge')
  })

  it('still opens after the player behind it deleted their account', async () => {
    const withoutPlayer = { ...sharedPayload, player: undefined }
    api.getSharedRun.mockResolvedValue(withoutPlayer)

    await act(async () => {
      render(<SharedRun token="AB2CD3" />, host)
    })
    await flush()

    expect(host.querySelector('.ed-sharedrun__score')?.textContent).toBe('17.412s')
    expect(host.querySelector('.ed-sharedrun__player')).toBeNull()
  })

  it('names a dead link rather than showing an empty card', async () => {
    api.getSharedRun.mockRejectedValue(new Error('not found'))

    await act(async () => {
      render(<SharedRun token="AB2CD3" />, host)
    })
    await flush()

    expect(host.textContent).toContain('Link not found')
    expect(host.textContent).toContain('Open Elixir Drop')
  })
})
