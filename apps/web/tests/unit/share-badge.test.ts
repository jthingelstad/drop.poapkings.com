import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  publishBadgeShare: vi.fn(),
  uploadBadgeShareImage: vi.fn()
}))
const card = vi.hoisted(() => ({ renderBadgeSharePreview: vi.fn() }))

vi.mock('../../src/lib/api', () => api)
vi.mock('../../src/lib/account', () => ({ sessionToken: () => 'test-session' }))
vi.mock('../../src/lib/share-card', () => card)

import { shareBadge, type BadgeShareInput } from '../../src/lib/share-badge'

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
  it('publishes and uploads the unfurl before sharing only its permanent URL', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    api.publishBadgeShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderBadgeSharePreview.mockResolvedValue(image)
    api.uploadBadgeShareImage.mockResolvedValue({ ok: true })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    await expect(shareBadge(badge)).resolves.toBe('shared')

    expect(api.publishBadgeShare).toHaveBeenCalledWith('clockbreaker', 2, 'test-session')
    expect(card.renderBadgeSharePreview).toHaveBeenCalledWith(preview)
    expect(api.uploadBadgeShareImage).toHaveBeenCalledWith('clockbreaker', 2, image, 'test-session')
    expect(share).toHaveBeenCalledWith({ url })
  })

  it('copies only the permanent URL when native sharing is unavailable', async () => {
    const image = new Blob(['png'], { type: 'image/png' })
    api.publishBadgeShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderBadgeSharePreview.mockResolvedValue(image)
    api.uploadBadgeShareImage.mockResolvedValue({ ok: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await expect(shareBadge(badge)).resolves.toBe('copied')

    expect(writeText).toHaveBeenCalledWith(url)
  })

  it('does not share a link when the preview cannot be rendered', async () => {
    api.publishBadgeShare.mockResolvedValue({ playerId: 'player-one', url, preview })
    card.renderBadgeSharePreview.mockResolvedValue(null)
    const share = vi.fn()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    await expect(shareBadge(badge)).resolves.toBe('unavailable')

    expect(api.uploadBadgeShareImage).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  vi.clearAllMocks()
})
