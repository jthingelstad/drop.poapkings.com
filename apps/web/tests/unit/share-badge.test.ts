import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  publishBadgeShare: vi.fn(),
  uploadBadgeShareImage: vi.fn()
}))
const card = vi.hoisted(() => ({ renderBadgeSharePreview: vi.fn() }))

vi.mock('../../src/lib/api', () => api)
vi.mock('../../src/lib/account', () => ({ sessionToken: () => 'test-session' }))
vi.mock('../../src/lib/share-card', () => card)

import { prepareBadgeShare, type BadgeShareInput } from '../../src/lib/share-badge'

const badge: BadgeShareInput = { slug: 'clockbreaker', rungIndex: 2 }
const url = 'https://drop.poapkings.com/share/P11111111/badge/clockbreaker/3'
const preview = {
  playerName: 'Knight Main',
  favoriteCardId: 26000000,
  slug: 'clockbreaker',
  name: 'Clockbreaker',
  tier: 'copper' as const,
  chip: '35s',
  rungIndex: 2,
  rungCount: 4,
  hidden: false,
  requirement: 'Fastest Surge run'
}

describe('badge sharing', () => {
  it('publishes and uploads the unfurl before returning its permanent URL', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    api.publishBadgeShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderBadgeSharePreview.mockResolvedValue(image)
    api.uploadBadgeShareImage.mockResolvedValue({ ok: true })
    await expect(prepareBadgeShare(badge)).resolves.toBe(url)

    expect(api.publishBadgeShare).toHaveBeenCalledWith('clockbreaker', 2, 'test-session')
    expect(card.renderBadgeSharePreview).toHaveBeenCalledWith(preview)
    expect(api.uploadBadgeShareImage).toHaveBeenCalledWith('clockbreaker', 2, image, 'test-session')
  })

  it('does not share a link when the preview cannot be rendered', async () => {
    api.publishBadgeShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderBadgeSharePreview.mockResolvedValue(null)
    await expect(prepareBadgeShare(badge)).rejects.toThrow('Badge preview is unavailable.')

    expect(api.uploadBadgeShareImage).not.toHaveBeenCalled()
  })
})

afterEach(() => vi.clearAllMocks())
