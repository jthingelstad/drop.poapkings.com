import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  publishProfileShare: vi.fn(),
  uploadProfileShareImage: vi.fn()
}))
const card = vi.hoisted(() => ({ renderProfileSharePreview: vi.fn() }))

vi.mock('../../src/lib/api', () => api)
vi.mock('../../src/lib/account', () => ({ sessionToken: () => 'test-session' }))
vi.mock('../../src/lib/share-card', () => card)

import { prepareProfileShare } from '../../src/lib/share-profile'

const url = 'https://drop.poapkings.com/share/P1111111111'
const preview = {
  playerName: 'Drop King',
  favoriteCardId: 26000000,
  xp: 900,
  arena: 8,
  badgeCount: 1,
  badges: [{ slug: 'clockbreaker', name: 'Clockbreaker', tier: 'gold' as const, chip: '25s' }]
}

describe('profile sharing', () => {
  it('refreshes and uploads the personalized unfurl before returning its permanent URL', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    api.publishProfileShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderProfileSharePreview.mockResolvedValue(image)
    api.uploadProfileShareImage.mockResolvedValue({ ok: true })

    await expect(prepareProfileShare()).resolves.toBe(url)

    expect(api.publishProfileShare).toHaveBeenCalledWith('test-session')
    expect(card.renderProfileSharePreview).toHaveBeenCalledWith(preview)
    expect(api.uploadProfileShareImage).toHaveBeenCalledWith(image, 'test-session')
  })

  it('does not expose a link before its preview is ready', async () => {
    api.publishProfileShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderProfileSharePreview.mockResolvedValue(null)

    await expect(prepareProfileShare()).rejects.toThrow('Profile preview is unavailable.')
    expect(api.uploadProfileShareImage).not.toHaveBeenCalled()
  })
})

afterEach(() => vi.clearAllMocks())
