import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'

const api = vi.hoisted(() => ({
  getSharedInvite: vi.fn(),
  getSharedRun: vi.fn(),
  createInviteShareToken: vi.fn(),
  publishRunShare: vi.fn(),
  uploadRunShareImage: vi.fn()
}))

const shareCard = vi.hoisted(() => ({ renderRunSharePreview: vi.fn() }))

vi.mock('../../src/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    getSharedInvite: api.getSharedInvite,
    getSharedRun: api.getSharedRun,
    createInviteShareToken: api.createInviteShareToken,
    publishRunShare: api.publishRunShare,
    uploadRunShareImage: api.uploadRunShareImage
  }
})

vi.mock('../../src/lib/share-card', () => ({ renderRunSharePreview: shareCard.renderRunSharePreview }))

vi.mock('../../src/lib/account', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/account')>()
  return { ...actual, sessionToken: () => 'test-session' }
})

import ShareLine from '../../src/components/ShareLine'
import SharedRun, { sharedRunToken } from '../../src/screens/SharedRun'
import SharedInvite, { sharedInviteToken } from '../../src/screens/SharedInvite'
import { duelSignature, rainSignature, survivalSignature, tradeSignature } from '../../src/lib/signatures'

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

// A published run is one link. The browser builds and uploads a preview from
// server-owned facts first, then hands the native sheet only that URL.
describe('sharing a run', () => {
  let host: HTMLDivElement

  function setNavigator(key: 'share' | 'clipboard', value: unknown) {
    Object.defineProperty(navigator, key, { value, configurable: true })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    api.publishRunShare.mockResolvedValue({
      playerId: '2ab53b64-57d7-42a4-b7d6-86bbce2ffcdf',
      runId: 'fc6fd2d1-c341-463f-aa95-a6a28e019d34',
      url: 'https://drop.poapkings.com/share/P1111111111/D2222222222',
      preview: {
        mode: 'surge',
        score: '17.412s',
        playerName: 'Drop King',
        favoriteCardId: 26000000,
        visual: { mode: 'surge', unit: 'SECONDS PER CARD', values: [1200, 900] }
      }
    })
    shareCard.renderRunSharePreview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    api.uploadRunShareImage.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    render(null, host)
    host.remove()
    setNavigator('share', undefined)
    setNavigator('clipboard', undefined)
  })

  async function tapShare() {
    await act(async () => {
      render(<ShareLine mode="surge" score="17.412s" runId="run-1" completedAt="2026-08-19T12:00:20.000Z" />, host)
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.ed-permalink__btn')!.click()
    })
    await flush()
    await flush()
  }

  it('publishes once and hands the native sheet only the clean link', async () => {
    const shared: ShareData[] = []
    setNavigator('share', async (payload: ShareData) => void shared.push(payload))

    await tapShare()

    expect(api.publishRunShare).toHaveBeenCalledWith('run-1', '2026-08-19T12:00:20.000Z', 'test-session')
    expect(shareCard.renderRunSharePreview).toHaveBeenCalledWith(
      expect.objectContaining({ playerName: 'Drop King', score: '17.412s' })
    )
    expect(api.uploadRunShareImage).toHaveBeenCalledWith(
      'run-1',
      '2026-08-19T12:00:20.000Z',
      expect.any(Blob),
      'test-session'
    )
    expect(shared).toHaveLength(1)
    expect(shared[0]).toEqual({
      url: 'https://drop.poapkings.com/share/P1111111111/D2222222222'
    })
    expect(host.textContent).toContain('Shared')
  })

  it('copies that same link with no fallback panel when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator('share', undefined)
    setNavigator('clipboard', { writeText })

    await tapShare()

    expect(writeText).toHaveBeenCalledWith('https://drop.poapkings.com/share/P1111111111/D2222222222')
    expect(host.querySelector('.shareline__unbundled')).toBeNull()
    expect(host.textContent).toContain('Link copied.')
  })

  it('does not open the share sheet when the PNG cannot be rendered', async () => {
    shareCard.renderRunSharePreview.mockResolvedValue(null)
    const shared: ShareData[] = []
    setNavigator('share', async (payload: ShareData) => void shared.push(payload))

    await tapShare()

    expect(api.uploadRunShareImage).not.toHaveBeenCalled()
    expect(shared).toHaveLength(0)
    expect(host.textContent).toContain('Sharing is unavailable right now.')
  })

  it('says so rather than sharing a link to nowhere when minting fails', async () => {
    api.publishRunShare.mockRejectedValue(new Error('offline'))
    const shared: ShareData[] = []
    setNavigator('share', async (payload: ShareData) => void shared.push(payload))

    await tapShare()

    expect(shared).toHaveLength(0)
    expect(host.textContent).toContain('Sharing is unavailable right now.')
  })
})

// The per-mode half of the same rule: every ranked signature already knows which
// bars cost the player something, so nothing has to be inferred at a call site.
describe('what each mode has to send', () => {
  it('names its red bars', () => {
    expect(rainSignature([900, 1400], [1200, 1200], [false, true]).bad).toEqual([false, true])
    expect(survivalSignature([900, 1400], [1200, 900], 1).bad).toEqual([false, true])
    expect(tradeSignature([900, 1400], [0, 2]).bad).toEqual([false, true])
    expect(duelSignature([900, 1400], [true, false]).bad).toEqual([false, true])
  })

  // Rain's fall time and Survival's window are the game's machinery: they
  // explain a run to the person who made it and mean nothing to a stranger.
  // Trade and Higher / Lower reference this run's own average, which is not a
  // reference the player owns across runs either. Only Surge's per-card best is.
  it('keeps a game-owned reference off the card even though the summary draws it', () => {
    expect(rainSignature([900], [1200], [false]).refs).toEqual([1200])
    expect(survivalSignature([900], [1200], -1).refs).toEqual([1200])
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

describe('the Recruiter invitation permalink', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    localStorage.clear()
    window.location.hash = ''
  })

  afterEach(() => {
    render(null, host)
    host.remove()
    localStorage.clear()
  })

  it('accepts the same readable token alphabet on the invitation route', () => {
    expect(sharedInviteToken('/s/AB2CD3')).toBe('AB2CD3')
    expect(sharedInviteToken('/s/ab2cd3')).toBe('AB2CD3')
    expect(sharedInviteToken('/s/AB0CD3')).toBeUndefined()
  })

  it('remembers attribution and replaces the capability route with its destination', async () => {
    api.getSharedInvite.mockResolvedValue({
      token: 'AB2CD3',
      kind: 'invite',
      destination: 'player',
      playerId: 'player/one'
    })

    await act(async () => {
      render(<SharedInvite token="AB2CD3" />, host)
    })
    await flush()

    expect(JSON.parse(localStorage.getItem('elixirdrop:recruiter:v1') || 'null')).toMatchObject({ token: 'AB2CD3' })
    expect(window.location.hash).toBe('#/players/player%2Fone')
  })
})
